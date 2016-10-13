'use strict';

var aws = require('aws-sdk');
var mysql = require("mysql");
var forEach = require('async-foreach').forEach;
var sizeof = require('object-sizeof');
var dateFormat = require('dateformat');
var SqsQueueParallel = require('sqs-queue-parallel');
var sqs = new aws.SQS({"accessKeyId":process.env.ACCESS_KEY_ID, "secretAccessKey": process.env.SECRET_ACCESS_KEY, "region": process.env.REGION});


module.exports.handler = function(event, context, cb) {
  var queue = new SqsQueueParallel({
      name: "generic_pushnote_queue",
      region:process.env.REGION,
      accessKeyId:process.env.ACCESS_KEY_ID,
      secretAccessKey:process.env.SECRET_ACCESS_KEY,
      maxNumberOfMessages: 10,
      concurrency: 10
  });
  queue.on('message', function (message)
  {
      sendNotification(message.data,message);
  });

  var sendNotification = function(body,message){

    var subject = body.subject;
    var messageBody = body.message;
    var offset = 0;
    var limit = parseInt(process.env.LIMIT);

    var pool = openConnectionToDB(body.host,body.username,body.password,body.database);

      pool.getConnection(function(err,connection){
        if (err) {
          //connection.release();
          //connection.destroy();
          //res.json({"code" : 100, "status" : "Error in connection database"});
          console.log("ERROR =============");
          return;
        }

        console.log('connected as id ' + connection.threadId);

        connection.query("SELECT * FROM ?? WHERE ?? = ? AND deleted_at IS NULL",['notifications','id',subject],function(err,rows){
            if(!err) {
              if(typeof rows[0] == 'undefined'){
                connection.release();
                connection.destroy();
              }
              if(typeof rows[0] != 'undefined'){

                //var updatedAtDB = new Date(rows[0].updated_at);
                //var updatedAtMessage = new Date(body.updated_at);
                //if(updatedAtDB.getTime() == updatedAtMessage.getTime()){
                  var sentDate = dateFormat(new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''), "yyyy-mm-dd");
                  connection.query('UPDATE ?? SET status = ?,sent_at = ? WHERE id = ?', ['notifications',"SENT",sentDate,subject],function(err,rows){
                      if(!err) {
                        connection.query("SELECT * FROM ?? WHERE ?? = ?",['queue_offset','queue',subject],function(err,rows){
                            if(!err) {
                              if(typeof rows[0] != 'undefined'){
                                offset = rows[0].offset;
                              }

                              var devicesQuery;
                              if(body.device == "ALL"){
                                if(body.action == "BIRTHDAY_PACK"){
                                  devicesQuery = mysql.format("SELECT * FROM devices d LEFT JOIN mobileusers m on d.mobileuser_id = m.id LEFT JOIN loyalty_user l on d.mobileuser_id = l.mobile_user_id LIMIT ? , ?",[offset, limit]);
                                }else{
                                  devicesQuery = mysql.format("SELECT * FROM ?? LIMIT ? , ?", ['devices', offset, limit]);
                                }

                              }else if(body.device == "APPLE"){
                                if(body.action == "BIRTHDAY_PACK"){
                                  devicesQuery = mysql.format("SELECT * FROM devices d LEFT JOIN mobileusers m on d.mobileuser_id = m.id LEFT JOIN loyalty_user l on d.mobileuser_id = l.mobile_user_id WHERE d.device = ? LIMIT ? , ?",['APPLE',offset, limit]);
                                }else{
                                  devicesQuery = mysql.format("SELECT * FROM ?? WHERE ?? = ? LIMIT ? , ?", ['devices','device','APPLE',offset, limit]);
                                }

                              }else if(body.device == "ANDROID"){
                                if(body.action == "BIRTHDAY_PACK"){
                                  devicesQuery = mysql.format("SELECT * FROM devices d LEFT JOIN mobileusers m on d.mobileuser_id = m.id LEFT JOIN loyalty_user l on d.mobileuser_id = l.mobile_user_id WHERE d.device = ? LIMIT ? , ?",['ANDROID',offset, limit]);
                                }else{
                                  devicesQuery = mysql.format("SELECT * FROM ?? WHERE ?? = ? LIMIT ? , ?", ['devices','device','ANDROID', offset, limit]);
                                }
                              }

                              var itemsProcessed = 1;
                              connection.query(devicesQuery, function(err,rows){
                                if(!err) {
                                  if(rows == ''){
                                    connection.release();
                                    connection.destroy();
                                  }
                                  if(typeof rows != 'undefined'){
                                    forEach(rows, function(item, index, arrDevices) {
                                      console.log(item.token_id+"=="+item.device);
                                      if(item.device == "APPLE"){
                                        var arn = body.applicationArns['applicationArnApple'];
                                      }

                                      if(item.device == "ANDROID"){
                                        var arn = body.applicationArns['applicationArnAndroid'];
                                      }
                                      console.log("UPDATED AT=="+body.updated_at);
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
                                          'timezone':body.timezone,
                                          'host':body.host,
                                          'username':body.username,
                                          'password':body.password,
                                          'database':body.database,
                                          'updated_at':body.updated_at,

                                        }),
                                        QueueUrl: "https://sqs.ap-southeast-1.amazonaws.com/272397067126/generic_pushnote_send_queue"
                                      };

                                      if(body.action == "BIRTHDAY_PACK"){
                                        if(item.dob != null && (item.points_tier != null || item.stamps_tier != null|| item.rebates_tier != null)){

                                          var dob = dateFormat(item.dob, "mm-dd");
                                          var dateNow = dateFormat(new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''), "mm-dd");

                                          if(item.mobileuser_id != "0" &&  dob == dateNow && (item.points_tier == body.value || item.stamps_tier == body.value|| item.rebates_tier == body.value)){
                                            sqs.sendMessage(params, function(err, data) {
                                                if (err){
                                                  console.log(err, err.stack);
                                                  connection.query('INSERT INTO failed_devices SET ?', { arn: arn, token: item.token_id, title: subject }, function(err,res){
                                                    if(!err){
                                                      console.log('Last insert ID:', res.insertId);
                                                    }
                                                  });
                                                }
                                                else {
                                                  console.log(data);
                                                }
                                            });
                                          }
                                        }
                                      }else{
                                        if(item.mobileuser_id != "0"){
                                          sqs.sendMessage(params, function(err, data) {
                                              if (err){
                                                console.log(err, err.stack);
                                                connection.query('INSERT INTO failed_devices SET ?', { arn: arn, token: item.token_id, title: subject }, function(err,res){
                                                  if(!err){
                                                    console.log('Last insert ID:', res.insertId);
                                                  }
                                                });
                                              }
                                              else {
                                                console.log(data);
                                              }
                                          });
                                        }
                                      }


                                      var newOffset;
                                      if(offset == 0){
                                        newOffset = ++offset;
                                        connection.query('INSERT INTO queue_offset SET ?', { queue: subject, offset: newOffset  }, function(err,res){
                                          if(!err){
                                            if(itemsProcessed == arrDevices.length){
                                              connection.release();
                                              connection.destroy();
                                            }
                                            itemsProcessed++;
                                          }
                                        });
                                      }else{
                                        newOffset = ++offset;
                                        connection.query('UPDATE ?? SET offset = ? WHERE queue = ?', ['queue_offset',newOffset,subject], function(err,res){
                                          if(!err){
                                            console.log('UPDATED===============================',newOffset);
                                            if(itemsProcessed == arrDevices.length){
                                              connection.release();
                                              connection.destroy();
                                            }
                                            itemsProcessed++;
                                            console.log("itemsProcessed"+itemsProcessed+"arr.length"+arrDevices.length);
                                          }
                                        });
                                      }
                                    }); // Close device foreach
                                  }
                                }
                            });//Close device query
                          }
                        });// Close queue_offset query
                      }
                  });// Close update notifications query
                } /*else {
                  message.deleteMessage(function(err, data) {
                    if(err){
                      console.log("Error deleting message: "+err);
                    }else{
                      console.log("Deleted message");
                    }
                  });
                  connection.query('DELETE FROM ?? WHERE queue = ?', ['queue_offset',subject], function(err,res){
                    if(!err){
                      connection.release();
                      connection.destroy();
                    }
                  });
                }*/

              }

            }
        });//Close select Notifications query
      });// Close pool connections

  };

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
