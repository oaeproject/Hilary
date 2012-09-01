var fs = require("fs");
var path = require("path");

//////////////////////////
// Reading file content //
//////////////////////////

exports.loadFileIntoArray = function(filename, callback) {
    fs.readFile(filename, "utf8", function(err, content) { 
        var finallines = [];
        var lines = content.split("\n");
        for (var i = 0; i < lines.length; i++){
            lines[i] = lines[i].replace(/\r/g, "");
            if (lines[i]){
                finallines.push(lines[i]);
            }
        }
        callback(finallines);
    });
};

exports.loadJSONFileIntoArray = function(filename, callback) {
    exports.loadFileIntoArray(filename, function(items) {
        for (var i = 0; i < items.length; i++){
            items[i] = JSON.parse(items[i]);
        }
        callback(items);
    });
};

////////////////////////////
// Reading folder content //
////////////////////////////

exports.folderExists = function(resource, callback) {
    path.exists(resource, callback);
};

exports.getFileListForFolder = function(foldername, callback) {
    exports.folderExists(foldername, function(exists) {
        if (exists) {
            fs.readdir(foldername, function(err, files) {
                var finalFiles = [];
                for (var f = 0; f < files.length; f++) {
                    if (files[f].substring(0, 1) !== ".") {
                        finalFiles.push(files[f])
                    }
                }
                callback(finalFiles);
            });
        } else {
            callback([]);
        }
    });
};