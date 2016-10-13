'use strict';

var aws = require('aws-sdk');
var mysql = require("mysql");
var forEach = require('async-foreach').forEach;
var sizeof = require('object-sizeof');
var dateFormat = require('dateformat');
var SqsQueueParallel = require('sqs-queue-parallel');
var sqs = new aws.SQS({"accessKeyId":process.env.ACCESS_KEY_ID, "secretAccessKey": process.env.SECRET_ACCESS_KEY, "region": process.env.REGION});
var moment = require('moment-timezone');

module.exports.handler = function(event, context, cb) {
  var queue = new SqsQueueParallel({
      name: "main_notification_queue_v3",
      region:process.env.REGION,
      accessKeyId:process.env.ACCESS_KEY_ID,
      secretAccessKey:process.env.SECRET_ACCESS_KEY,
      maxNumberOfMessages: 1,
      concurrency: 10,
      debug: false
  });

  queue.on('message', function (message)
  {
      sendNotification(message.data,message);

  });

  var sendNotification = function(body,message){

    var subject = body.subject;
    var engagement = subject.split("-");
    var engagement_id = engagement[1];
    var messageBody = body.message;
    var offset = 0;
    var limit = 300;

    if (body.action == "ENGAGEMENT_NOTIFICATION"){

      var pool = openConnectionToDB(body.host,body.username,body.password,body.database);

      pool.getConnection(function(err,connection){
        if (err) {
          return;
        }

        console.log('connected as id ' + connection.threadId);
        connection.query('SELECT * FROM ?? WHERE ?? = ?', ['engagements','id',parseInt(engagement_id)],function(err,rows){
            if(!err) {
                var engagementItem = rows[0];
                moment().tz(body.timezone).format();
                var now = new Date();
                var currentDateTime = moment.tz(now,body.timezone);
                var startDateTimeUTC = moment.tz(body.start_date,"Africa/Abidjan");
                var startDateTime = moment.tz(startDateTimeUTC,body.timezone);
                var endDateTimeUTC = moment.tz(body.end_date,"Africa/Abidjan");
                var endDateTime = moment.tz(endDateTimeUTC,body.timezone);
                var updatedAtDB = new Date(engagementItem.updated_at);
                var updatedAtMessage = new Date(body.updated_at);
                console.log("DB====OK====================="+startDateTime.format() +"<="+ currentDateTime.format()+"<="+endDateTime.format());
                console.log("DB====OKOK====================="+(startDateTime.format() <= currentDateTime.format() && currentDateTime.format() <= endDateTime.format()));
                if(updatedAtDB.getTime() == updatedAtMessage.getTime()){
                  if(engagementItem.status == "LIVE" && startDateTime.format() <= currentDateTime.format() && currentDateTime.format() <= endDateTime.format()){
                    connection.query("SELECT * FROM ?? WHERE ?? = ?",['queue_offset','queue',subject],function(err,rows){
                        if(!err) {
                          if(typeof rows[0] != 'undefined'){
                            offset = rows[0].offset;
                          }
                          var devicesQuery;
                          if(body.device == "ALL"){
                            devicesQuery = mysql.format("SELECT * FROM ?? LIMIT ? , ?", ['devices', offset, limit]);
                          }else if(body.device == "APPLE"){
                            devicesQuery = mysql.format("SELECT * FROM ?? WHERE ?? = ? LIMIT ? , ?", ['devices','device','APPLE', offset, limit]);
                          }else if(body.device == "ANDROID"){
                            devicesQuery = mysql.format("SELECT * FROM ?? WHERE ?? = ? LIMIT ? , ?", ['devices','device','ANDROID', offset, limit]);
                          }

                          var itemsProcessed = 1;
                          connection.query(devicesQuery, function(err,rows){
                            if(!err) {
                              if(rows == ''){
                                connection.release();
                                connection.destroy();
                                message.deleteMessage(function(err, data) {
                                  if(err){
                                    console.log("Error deleting message: "+err);
                                  }else{
                                    console.log("Deleted message");
                                  }
                                  //message.next();
                                });
                              }
                              if(typeof rows != 'undefined'){
                                forEach(rows, function(item, index, arrDevices) {


                                  if(item.device == "APPLE"){
                                    var arn = body.applicationArns['applicationArnApple'];
                                  }

                                  if(item.device == "ANDROID"){
                                    var arn = body.applicationArns['applicationArnAndroid'];
                                  }

                                  if(item.mobileuser_id != "0"){
                                    connection.query('SELECT * FROM ?? WHERE ?? = ? AND ?? <= ? AND ?? >= ?', ['lists_data_batch','list_id',body.value,'start_mobileuser_id',parseInt(item.mobileuser_id),'end_mobileuser_id',parseInt(item.mobileuser_id)], function(listDataErr,listDataRows){
                                      if(!listDataErr) {
                                        //console.log(listDataRows);
                                        //console.log(item.mobileuser_id);
                                        if(typeof listDataRows[0] != 'undefined'){
                                          var listBatchId = listDataRows[0].id;
                                          var mobileusersArr = JSON.parse("[" + listDataRows[0].mobileusers + "]");
                                          //console.log('mobileusersArr:', mobileusersArr);
                                          if ((mobileusersArr).indexOf(item.mobileuser_id) > -1){
                                            //console.log(listDataRows);
                                        //console.log(item.mobileuser_id);
                                            var params = {
                                              MessageBody: JSON.stringify({"platformApplicationArn":arn,
                                                'token':item.token_id,
                                                'message': messageBody,
                                                'subject':subject,
                                                'accessKeyId':body.accessKeyId,
                                                'secretAccessKey':body.secretAccessKey,
                                                'region':body.region,
                                                'notfType':body.notfType,
                                                'scheduledAt':body.scheduledAt,
                                                'host':body.host,
                                                'username':body.username,
                                                'password':body.password,
                                                'database':body.database,

                                              }),
                                              QueueUrl: "https://sqs.ap-southeast-1.amazonaws.com/272397067126/SQS_Test_App_v3"
                                            };
                                            sqs.sendMessage(params, function(err, data) {
                                              if (err){
                                                console.log(err, err.stack);
                                                connection.query('INSERT INTO failed_devices SET ?', { arn: arn, token: item.token_id, title: subject }, function(err,res){
                                                  if(err) throw err;

                                                  console.log('Last insert ID:', res.insertId);
                                                });
                                              }
                                              else {
                                                console.log(data);
                                                connection.release();
                                                connection.destroy();
                                                message.next();
                                              }
                                            });
                                          }
                                        }
                                      }
                                    }); // End lists_data_batch query
                                  }// check mobileuser_id != 0

                                  var newOffset;
                                  if(offset == 0){
                                    newOffset = ++offset;
                                    connection.query('INSERT INTO queue_offset SET ?', { queue: subject, offset: newOffset  }, function(err,res){
                                      if(err) {console.log('Error inserting into queue_offset', err);}
                                      else{
                                        console.log('INSERTED===============================',newOffset);
                                        console.log('Last insert ID:', res.insertId);
                                        itemsProcessed++;
                                      }
                                    });
                                  }else{
                                    newOffset = ++offset;
                                    connection.query('UPDATE queue_offset SET offset = ? WHERE queue = ?', [newOffset,subject], function(err,res){
                                      if(err) {console.log('Error =================', newOffset);}
                                      else{
                                        console.log('UPDATED===============================',newOffset);
                                        if(itemsProcessed == arrDevices.length){
                                          connection.release();
                                          connection.destroy();
                                          //message.next();
                                        }
                                        itemsProcessed++;
                                        console.log("itemsProcessed"+itemsProcessed+"arr.length"+arrDevices.length);
                                      }

                                    });
                                  }

                                }); // End device foreach
                              }
                            }
                          });// End device query

                        }
                    });// End queue_offset query
                  }else{
                    connection.release();
                    connection.destroy();
                    //message.next();
                  }

                }

                if(updatedAtDB.getTime() > updatedAtMessage.getTime()){
                  connection.release();
                  connection.destroy();
                  message.deleteMessage(function(err, data) {
                    if(err){
                      console.log("Error deleting message: "+err);
                    }else{
                      console.log("Deleted message");
                    }
                    ////////message.next();
                  });

                }
            } // End (if != err)
        });// End engagements query

        connection.on('error', function(err) {
              return;
        });


      });// End pool.getConnection
    }
  };// End sendNotification


  var openConnectionToDB = function(host,username,password,database) {
    var pool      =    mysql.createPool({
        connectionLimit : 1, //important
        host     : host,
        user     : username,
        password : password,
        database : database,
        debug    : false
    });

    return pool;

  };
};
