/**
 * Copyright 2012 Sakai Foundation (SF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 * 
 *     http://www.osedu.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var fs = require('fs');

var IO = require('oae-util/lib/io');

//////////////////////////
// Reading file content //
//////////////////////////

module.exports.loadFileIntoArray = function(filename, callback) {
    IO.readFile(filename, function(err, content) { 
        var finallines = [];
        var lines = content.split("\n");
        for (var i = 0; i < lines.length; i++) {
            lines[i] = lines[i].replace(/\r/g, "");
            if (lines[i]){
                finallines.push(lines[i]);
            }
        }
        callback(finallines);
    });
};

module.exports.loadJSONFileIntoArray = function(filename, callback) {
    exports.loadFileIntoArray(filename, function(items) {
        for (var i = 0; i < items.length; i++) {
            items[i] = JSON.parse(items[i]);
        }
        callback(items);
    });
};