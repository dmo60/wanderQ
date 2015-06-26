var MongoClient = require("mongodb").MongoClient
    , mysql = require("mysql")
    , async = require("async")
    , config = require("./config")
    , geoJson = require("./geoJson");

exports.initialize = function (cb) {
    console.log("Initializing mongo database...");

    async.waterfall([
        // Connect to the Mongo database
        function (callback) {
            console.log("Connecting to mongo...");
            MongoClient.connect(config.MongoUrl, function (err, db) {
                if (err) {
                    callback(err)
                } else {
                    callback(null, db);
                }
            });
        },

        // Connect to the MediaQ database
        function (mongoDb, callback) {
            console.log("Connecting to MediaQ database...");
            var mySqlDb = mysql.createConnection(config.MySql);
            mySqlDb.connect(function (err) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, mongoDb, mySqlDb)
                }
            });
        },

        // Drop all existing documents
        function (mongoDb, mySqlDb, callback) {
            console.log("Dropping existing documents...");
            mongoDb.collection("videos").deleteMany({}, function (err, reply) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, mongoDb, mySqlDb);
                }
            });
        },

        // Get a list of videos from the MediaQ server
        function (mongoDb, mySqlDb, callback) {
            console.log("Getting list of videos from MediaQ server...");
            // We only want to select videos that have at least two different positions,
            // otherwise we cannot build a valid trajectory later.
            var sql =
                "SELECT VideoId, Plat, Plng, Keywords FROM VIDEO_METADATA AS t1 " +
                "WHERE FovNum=1 AND EXISTS (" +
                "SELECT * FROM VIDEO_METADATA AS t2 WHERE t1.VideoId=t2.VideoId AND " +
                "(t1.Plat != t2.Plat OR t1.Plng != t2.Plng) )";
            mySqlDb.query(sql, function (err, rows) {
                if (err) {
                    callback(err);
                } else {
                    rows.forEach(function (video) {
                        // We want the coordinates to be stored as a geo point
                        video.location = new geoJson.Point(video.Plat, video.Plng);
                        delete video.Plat;
                        delete video.Plng;
                    });
                    callback(null, rows, mongoDb, mySqlDb);
                }
            });
        },

        // Load the trajectory for each video
        function (videos, mongoDb, mySqlDb, callback) {
            console.log("Loading trajectories for videos...");
            async.each(videos, function (video, callback) {
                var sql =
                    "SELECT Plat, Plng, TimeCode, ThetaX, ThetaY, ThetaZ, R, Alpha" +
                    " FROM VIDEO_METADATA " +
                    "WHERE VideoId=? ORDER BY TimeCode ASC";

                mySqlDb.query(sql, [video.VideoId], function (err, rows) {
                    if (err) {
                        callback(err);
                    } else {
                        var wayPoints = [];

                        rows.forEach(function (r) {
                            wayPoints.push([r.Plng, r.Plat, parseInt(r.TimeCode), r.ThetaX, r.ThetaY, r.ThetaZ, r.R, r.Alpha]);
                        });

                        video.trajectory = new geoJson.LineString(wayPoints);
                        callback();
                    }
                });
            }, function (err) {
                if (err) {
                    callback(err);
                } else {
                    mySqlDb.end();
                    callback(null, videos, mongoDb);
                }
            })
        },

        // Insert all videos into mongo
        function (videos, mongoDb, callback) {
            console.log("Inserting videos into mongo...");
            mongoDb.collection("videos").insertMany(videos, function (err, reply) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, mongoDb);
                }
            })
        },

        // Create an index on the trajectory property
        function (mongoDb, callback) {
            console.log("Creating geo index for trajectory...");
            mongoDb.collection("videos").createIndex({trajectory: "2dsphere"}, null, function (err, indexName) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, mongoDb);
                }
            });
        },

        // Create an index on the location property
        function (mongoDb, callback) {
            console.log("Creating geo index for location...");
            mongoDb.collection("videos").createIndex({location: "2dsphere"}, null, function (err, indexName) {
                if (err) {
                    callback(err);
                } else {
                    mongoDb.close();
                    callback(null, "Done!");
                }
            });
        }

    ], function (err, result) {
        if (err) {
            console.error("Error! " + err);
            cb(err);
        } else {
            console.log(result);
            cb(null);
        }
    });
};