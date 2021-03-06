var path = require("path");
var fs = require("fs");
var request = require("request");
var hashFiles = require('hash-files');
var csv = require("fast-csv");
var moment = require('moment');
var mime = require('mime');

if (process.argv.length < 3) {
    console.error("Usage: node cli.js <taggunApiKey> <exiftool-output.csv>");
    process.exit(0);
    throw "Abort";
}

var taggunCachePath = path.join(__dirname, "taggun-cache");
var taggunApiKey = process.argv[2];

var csvDataFilePath = process.argv[3];
console.log("csvDataFilePath", csvDataFilePath);
var sourceFilesDirectory = path.dirname(csvDataFilePath);
console.log("sourceFilesDirectory", sourceFilesDirectory);

async function requestTaggunMetadataJson(receiptPath) {

    var filename = path.basename(receiptPath);
    var contentType = mime.lookup(receiptPath);

    const formData = {
        //ipAddress: '1.2.3.4',
        file: {
            value: fs.createReadStream(receiptPath),
            options: {
                filename: filename,
                contentType: contentType,
            }
        }
    };

    return new Promise(function (resolve, reject) {

        request.post({
            url: 'https://api.taggun.io/api/receipt/v1/verbose/file', formData,
            headers: {apikey: taggunApiKey}
        }, (err, httpResponse, body) => {
            if (err) {
                console.error('Upload failed');
                return reject(err);
            }
            console.log('Upload successful!');
            resolve(body);
        });

    });

}

async function requestTaggunMetadataJsonIfNotAlreadyCached(receiptPath) {

    return new Promise(function (resolve, reject) {

        // check if already has taggun metadata
        var options = {
            files: [receiptPath],
            noGlob: true,
            algorithm: 'sha1',
        };
        hashFiles(options, async function (error, hash) {
            // hash will be a string if no error occurred

            console.log(`hash of ${receiptPath}`, hash);

            var taggunMetadataJsonPath = path.join(taggunCachePath, hash + '.json');

            if (!fs.existsSync(taggunMetadataJsonPath)) {

                var taggunMetadataJson = await requestTaggunMetadataJson(receiptPath);
                var taggunMetadata = JSON.parse(taggunMetadataJson);
                taggunMetadata.contentSha1Hash = hash;
                taggunMetadataJson = JSON.stringify(taggunMetadata);
                //console.log('taggunMetadataJson', taggunMetadataJson);

                console.log('Storing taggunMetadataJson json');
                fs.writeFile(taggunMetadataJsonPath, taggunMetadataJson, function (resultsWriteErr) {
                    if (resultsWriteErr) {
                        console.error(`Couldn't write data to ${taggunMetadataJsonPath}!`);
                        console.error(resultsWriteErr);
                        return reject(resultsWriteErr);
                    }
                    resolve(taggunMetadataJson);
                });


            } else {
                console.log('Taggun metadata already cached');
                var taggunMetadataJson = fs.readFileSync(taggunMetadataJsonPath);
                var taggunMetadata = JSON.parse(taggunMetadataJson);
                taggunMetadata.contentSha1Hash = hash;
                taggunMetadataJson = JSON.stringify(taggunMetadata);
                //console.log('taggunMetadataJson', taggunMetadataJson);
                resolve(taggunMetadataJson);
            }

        });

    });

}

async function loadCsv(csvDataFilePath) {

    var csvRows = [];

    return new Promise(function (resolve, reject) {

        csv
            .fromPath(csvDataFilePath, {
                headers: true,
            })
            .on("data", function (data) {
                //console.log('data', data);
                csvRows.push(data);
            })
            .on("end", function () {
                console.log("Done reading csv");
                resolve(csvRows);
            });

    });

}

async function getReconciliationMetadata(csvRows, sourceFilesDirectory) {

    var reconciliationMetadata = [];

    for (var i = 0, len = csvRows.length; i < len; i++) {
        var csvRow = csvRows[i];

        var relativePath = csvRow.SourceFile;
        //console.log('relativePath', relativePath, csvRow);
        var receiptPath = path.join(sourceFilesDirectory, relativePath);

        let taggunMetadata;
        try {
            const taggunMetadataJson = await requestTaggunMetadataJsonIfNotAlreadyCached(receiptPath);
            taggunMetadata = JSON.parse(taggunMetadataJson);
        } catch (err) {
            // return error info in taggun metadata on error
            taggunMetadata = {
                error: err,
            };
        }
        //console.log('taggunMetadata.error', taggunMetadata.error);

        var date = null;
        if (taggunMetadata.date && taggunMetadata.date.data) {
            date = moment(taggunMetadata.date.data).format("YYYY-MM-DD");
        }

        var contentType = mime.lookup(receiptPath);
        var filename = path.basename(relativePath);
        var directory = path.dirname(relativePath);

        var stats = fs.statSync(receiptPath);
        //console.log('stats', stats);

        reconciliationMetadata.push({
            directory: directory,
            filename: filename,
            date: date,
            dateText: taggunMetadata.date ? taggunMetadata.date.text : '',
            totalAmount: taggunMetadata.totalAmount ? taggunMetadata.totalAmount.data : '',
            totalAmountText: taggunMetadata.totalAmount ? taggunMetadata.totalAmount.text : '',
            taxAmount: taggunMetadata.taxAmount ? taggunMetadata.taxAmount.data : '',
            taxAmountText: taggunMetadata.taxAmount ? taggunMetadata.taxAmount.text : '',
            merchantName: taggunMetadata.merchantName ? taggunMetadata.merchantName.data : '',
            merchantNameText: taggunMetadata.merchantName ? taggunMetadata.merchantName.text : '',
            merchantAddress: taggunMetadata.merchantAddress ? taggunMetadata.merchantAddress.data : '',
            merchantAddressText: taggunMetadata.merchantAddress ? taggunMetadata.merchantAddress.text : '',
            text: taggunMetadata.text ? taggunMetadata.text.text : '',
            contentSha1Hash: taggunMetadata.contentSha1Hash,
            contentType: contentType,
            path: relativePath,
            created: moment(stats.birthtime).format("YYYY-MM-DD HH:mm"),
            modified: moment(stats.mtime).format("YYYY-MM-DD HH:mm"),
            ctime: moment(stats.ctime).format("YYYY-MM-DD HH:mm"),
            ocrErrorOccurred: taggunMetadata.error ? 1 : 0,
            //taggunMetadata: taggunMetadata,
            //csvRow: csvRow,
        });

    }

    return reconciliationMetadata;

}

(async () => {
    try {

        var csvRows = await loadCsv(csvDataFilePath);
        var reconciliationMetadata = await getReconciliationMetadata(csvRows, sourceFilesDirectory);

        console.log('Storing results.csv');
        csv
            .writeToPath("./results.csv", reconciliationMetadata, {
                quoteColumns: true,
                headers: [
                    'Matched',
                    'Hash',
                    'Link',
                    'Comment',
                    'Directory',
                    'Filename',
                    'Amount',
                    'Amount (OCR)',
                    'Date',
                    'Date initiated',
                    'Date settled',
                    'Date (OCR)',
                    'Tax Amount',
                    'Tax Amount (OCR)',
                    'Merchant name',
                    'Merchant name (OCR)',
                    'Merchant address',
                    'Merchant address (OCR)',
                    'Text',
                    'Content type',
                    'Path',
                    'Created',
                    'Modified',
                    'Ctime',
                    'OCR-error occurred?',
                ],
                transform: function (row) {
                    return {
                        'Matched': '', // replaced by status column in spreadsheet
                        'Hash': row.contentSha1Hash,
                        'Link': '', // replaced by formula in spreadsheet
                        'Comment': '', // custom column in spreadsheet
                        'Directory': row.directory,
                        'Filename': row.filename,
                        'Amount': row.totalAmount,
                        'Amount (OCR)': row.totalAmountText,
                        'Date': '', // replaced by formula in spreadsheet
                        'Date initiated': row.date,
                        'Date settled': '',
                        'Date (OCR)': row.dateText,
                        'Tax Amount': row.taxAmount,
                        'Tax Amount (OCR)': row.taxAmountText,
                        'Merchant name': row.merchantName,
                        'Merchant name (OCR)': row.merchantNameText,
                        'Merchana address': row.merchantAddress,
                        'Merchana address (OCR)': row.merchantAddressText,
                        'Text': row.text,
                        'Content type': row.contentType,
                        'Path': row.path,
                        'Created': row.created,
                        'Modified': row.modified,
                        'Ctime': row.ctime,
                        'OCR-error occurred?': row.ocrError,
                    };
                },
            })
            .on("finish", function () {
                console.log("CSV export done!");
            });

        console.log('Storing results.json');
        fs.writeFile('./results.json', JSON.stringify(reconciliationMetadata, null, 2) + "\n", function (resultsWriteErr) {
            if (resultsWriteErr) {
                console.error("Couldn't write data to results.json!");
                console.error(resultsWriteErr);
            } else {
                console.log("JSON export done!");
            }
        });

    } catch (e) {
        console.log(e)
    }
})();

