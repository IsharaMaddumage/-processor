'use strict';

var aws = require('aws-sdk');
var mysql = require("mysql");
var SqsQueueParallel = require('sqs-queue-parallel');
var sizeof = require('object-sizeof');
var moment = require('moment-timezone');

module.exports.handler = function(event, context, cb) {
  var queue = new SqsQueueParallel({
    name: "SQS_Test_App",
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
    var params = {'PlatformApplicationArn':body.platformApplicationArn,'Token': body.token};

    var sns = new aws.SNS({"accessKeyId": body.accessKeyId, "secretAccessKey": body.secretAccessKey, "region": body.region});
    var subject = body.subject;
    
    var messageBody = JSON.parse(body.message);
    var message_full = messageBody.message_full;
    var default_message = messageBody.message_content;
    if(default_message == 'test'){
       default_message = message_full['additional_params']['description'];
    }
    //console.log('default_message'+default_message);
    var clientMessage = {
                          'GCM' : JSON.stringify({
                              'data' : {
                                  'default' : JSON.stringify(default_message),
                                  'message': JSON.stringify(message_full['additional_params'])
                              }
                          }),
                          'APNS': JSON.stringify({
                              'aps' : {
                                  'alert': default_message,
                              },

                              'message' : message_full['additional_params']
                          }),
                        };
    
    if(typeof messageBody.message_full['additional_params_aps'] != 'undefined'){
        clientMessage['APNS'] = JSON.stringify(messageBody.message_full['additional_params_aps']);
    }


    if(message_full['additional_params']['action_type'] == 'SUSPENDED' || message_full['additional_params']['action_type'] == 'WELCOME_PACK'){
        if(body.notfType == "SCHEDULED"){
          moment().tz(body.timezone).format();
          var now = new Date();
          var currentDateTime = moment.tz(now,body.timezone);
          var utcDateTime = moment.tz(body.scheduledAt,"Africa/Abidjan");
          var scheduledDateTime = moment.tz(utcDateTime,body.timezone);
          
          if(scheduledDateTime.format()<=currentDateTime.format()){
            send(params,clientMessage,subject,sns,message);
          }
        }

        if(body.notfType == "IMMEDIATE"){
          send(params,clientMessage,subject,sns,message);
        }

        if(body.notfType == "DAILY"){
          send(params,clientMessage,subject,sns,message);
        }
    }else{

      if(params.Token == ""){
        message.deleteMessage(function(err, data) {
          if(err){
            console.log("Error deleting message: "+err); 
          }else{
            console.log("Deleted message"); 
          }
          message.next();
        });
      }else{

        var con = openConnectionToDB(body.host,body.username,body.password,body.database);
      
        if(con){
          var notificationQuery = mysql.format("SELECT * FROM ?? WHERE ?? = ? AND deleted_at IS NULL",['notifications','id',subject]);
          
          con.query(notificationQuery, function(err, rowsNotification, fieldsNotification) {
              if (err) {message.next();}

              else{
                if(rowsNotification[0] == 'undefined'){
                  message.deleteMessage(function(err, data) {
                      if(err){
                        console.log("Error deleting message: "+err); 
                      }
                      message.next();
                  });
                }
                if(rowsNotification[0] != 'undefined'){
                    var updatedAtDB = new Date(rowsNotification[0].updated_at);
                    var updatedAtMessage = new Date(body.updated_at);

                    if(updatedAtDB.getTime() == updatedAtMessage.getTime()){

                      if(body.notfType == "SCHEDULED"){
                        moment().tz(body.timezone).format();
                        var now = new Date();
                        var currentDateTime = moment.tz(now,body.timezone);
                        var utcDateTime = moment.tz(body.scheduledAt,"Africa/Abidjan");
                        var scheduledDateTime = moment.tz(utcDateTime,body.timezone);
                        
                        console.log("Sche "+scheduledDateTime.format()+"cur"+currentDateTime.format());
                        if(scheduledDateTime.format()<=currentDateTime.format()){
                          send(params,clientMessage,subject,sns,message);
                        }
                      }

                      if(body.notfType == "IMMEDIATE"){
                        send(params,clientMessage,subject,sns,message);
                      }

                      if(body.notfType == "DAILY"){
                        send(params,clientMessage,subject,sns,message);
                      }
                    }else{
                      message.deleteMessage(function(err, data) {
                          if(err){
                            console.log("Error deleting message: "+err); 
                          }
                          message.next();
                      });
                    }
                }
              }

              
          });
          closeConnectionToDB(con);
          
        }else{
          message.next();
        }

      }

      
    
    }
    
    

  };

  var send = function(params,clientMessage,subject,sns,message){
    sns.createPlatformEndpoint(params,function(err,EndPointResult)
    {
        if(EndPointResult != null){
          var clientArn = EndPointResult["EndpointArn"];
          sns.publish(
            {
              TargetArn: clientArn,
              Message: JSON.stringify(clientMessage),
              Subject: JSON.stringify(subject),
              MessageStructure: 'json'
            },
            function(err,data){
              if (err) {
                  console.log("Error sending a message "+err+JSON.stringify(params.Token));
                  if(err == "EndpointDisabled: Endpoint is disabled"){
                    sns.deleteEndpoint({'EndpointArn': clientArn}, function(err, data) {
                      if (err) console.log("Error removing Endpoint Arn: "+err); 
                    });
                    message.deleteMessage(function(err, data) {
                      if(err){
                        console.log("Error deleting message: "+err); 
                      }
                      message.next();
                    });
                  }
                  message.next();
              } else {
                  var messagedate = new Date();
                  console.log("Sent message: "+data.MessageId+messagedate+JSON.stringify(params));
                  sns.deleteEndpoint({'EndpointArn': clientArn}, function(err, data) {
                    if (err) console.log("Error removing Endpoint Arn: "+err); 
                  });
                  message.deleteMessage(function(err, data) {
                    if(err){
                      console.log("Error deleting message: "+err); 
                    }
                    message.next();
                  });
              }
            }
          );
        }
        if(EndPointResult == null){
          message.next();
        }
        
    });
  };

  var openConnectionToDB = function(host,username,password,database) {
    var con = mysql.createConnection({
      host: host,
      user: username,
      password: password,
      database : database,
      multipleStatements: true
    });
    
    con.connect(function(err){
      if(err){
        //message.next();
        console.log('Error connecting to Db'+err);
        /*if(err == "Error: connect ETIMEDOUT"){
          console.log('Error message new'+JSON.stringify(message));
        }*/
        return false;
      }else{
        console.log('Connection established');
      }
      
    });
    
    return con;
    
  };

  var closeConnectionToDB = function(con) {
    con.end(function(err) {
        if(err) { console.log("Error closing connection "+err);  } 
        else {    
          console.log("closed connection");  
        }   
    });
  };
  
  queue.on('error', function (err)
  {
    console.log('There was an error: ', err);
  });
};
