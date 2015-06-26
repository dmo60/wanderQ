/**
 * Created by Fabian on 12.06.2015.
 */
var MongoClient = require("mongodb").MongoClient;
var async = require("async");
var config = require("./config");

exports.RequestHandler = function (req, res) {

    var queryVideoId = req.query.videoID;

    async.waterfall([
        function (callback) {
            MongoClient.connect(config.MongoUrl, function (err, db) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, db);
                }
            })
        },

        function (mongoDb, callback) {
            mongoDb.collection("videos").findOne({VideoId: queryVideoId}, {fields: {trajectory: 1}}, function (err, result) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, result.trajectory, mongoDb);
                }
            });
        },

        function (queryTrajectory, mongoDb, callback) {
            mongoDb.collection("videos").find({
                VideoId: {$ne: queryVideoId},
                trajectory: {
                    $geoIntersects: {
                        $geometry: queryTrajectory
                    }
                }
            }).toArray(function (err, docs) {
                mongoDb.close();
                if (err) {
                    callback(err);
                } else {
                    callback(null, docs)
                }
            });
        }
    ], function (err, videos) {
        if (err) {
            console.err("Error! " + err);
            res.send("Database error!");
        } else {
            console.log("Number of videos found: " + videos.length);
            res.json(videos);
        }
    });

};