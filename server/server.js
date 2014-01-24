var http = require("http");
var url = require("url");
var sys = require("sys");
var events = require("events");
var formidable = require('formidable');
var util = require('util');
var fs   = require('fs');


var server = http.createServer(function(req, res) {
    // Simple path-based request dispatcher
    switch (url.parse(req.url).pathname) {
        case '/':
            display_form(req, res);
            break;
        case '/upload':
            upload_file(req, res);
            break;
        default:
            show_404(req, res);
            break;
    }
});

// Server would listen on port 8000
server.listen(80);

/*
 * Display upload form
 */
function display_form(request, response) {
    var body = '<h1>Hello!</h1>'+
        '<form action="/upload" method="post" enctype="multipart/form-data">'+
        '<input type="file" name="upload-file">'+
        '<input type="submit" value="Upload">'+
        '</form>';
    response.writeHead(200, {
      'Content-Length': body.length,
      'Content-Type': 'text/html' });
    response.end(body);
}

/*
 * Handle file upload
 */
function upload_file(request, response) {
    // if (request.method.toLowerCase() == 'post')

    var form = new formidable.IncomingForm();
    form.uploadDir = "/Users/dragvs/Dev/CrashesOnline/server/tmp_upload";

    var targetDir = "/Users/dragvs/Dev/CrashesOnline/server/uploaded";

    form.on('fileBegin', function(name, file) {
        console.log("Form on File begin: " + file.name);
    });

    form.on('progress', function(bytesReceived, bytesExpected) {
        var progress = (bytesReceived / bytesExpected * 100).toFixed(2);
        var receivedKb = (bytesReceived / 1024).toFixed(1);
        var expectedKb = (bytesExpected / 1024).toFixed(1);
     
        console.log("Form Uploading " + receivedKb + " Kb of " + expectedKb + " Kb (" + progress + "%)");
    });

    form.on('error', function(err) {
        console.error("Form error: " + err);
    });

    form.on('end', function(fields, files) {
        console.log("Form on End");

        // for (var file in this.openedFiles) {
        {
            var file = this.openedFiles[0];
            console.log("   File path " + file.path);
            console.log("   File name " + file.name);

            var newFilePath = targetDir + "/" + file.name;

            // fs.copy(file.path, newFilePath, function(err) {  
            //     if (err) {
            //         console.error(err);
            //     } else {
            //         console.log("tmp uploaded file copied!")
            //     }
            // });
            fs.rename(file.path, newFilePath, function(err2) {  
                if (err2) {
                    console.error("File rename error: " + err2);
                } else {
                    console.log("Uploaded tmp file renamed");
                }
            });
        }
    });

    form.parse(request, function(err, fields, files) {
        console.log("Form on Parse");

        // Render response
        var body = "Thanks for playing!\n";
        body = body + "received upload:\n\n";
        body = body + util.inspect({fields: fields, files: files});

        response.writeHead(200, {
          'Content-Length': body.length,
          'Content-Type': 'text/plain' });
        response.end(body);
    });
}

/*
 * Handles page not found error
 */
function show_404(request, response) {
    var body = "You'r doing it wrong!";
    response.writeHead(404, {
      'Content-Length': body.length,
      'Content-Type': 'text/plain' });
    response.end(body);
}