'use strict';

var aws = require('aws-sdk');
var mysql = require("mysql");
var SqsQueueParallel = require('sqs-queue-parallel');
var sizeof = require('object-sizeof');

module.exports.handler = function(event, context, cb) {
  var queue = new SqsQueueParallel({
    name: "SQS_Test_App_v2",
    region:"ap-southeast-1",
    accessKeyId:process.env.ACCESS_KEY_ID,
    secretAccessKey:process.env.SECRET_ACCESS_KEY,
    maxNumberOfMessages: 10,
    concurrency: 10
});
queue.on('message', function (message)
{
    //var messagedate = new Date();
    //console.log('New message: '+ messagedate);
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

    if(message_full['additional_params']['description'] != 'undefined'){
      var push_message = message_full['additional_params']['description'];
    }else{
      var push_message = default_message;
    }
    console.log('push_message type'+typeof default_message);
    console.log('push_message '+ default_message);
    var clientMessage = {
                          'GCM' : JSON.stringify({
                              'data' : {
                                  'default' : push_message,
                                  'message': JSON.stringify(message_full['additional_params'])
                              }
                          }),
                          'APNS': JSON.stringify({
                              'aps' : {
                                  'alert': push_message,
                              },

                              'message' : message_full['additional_params']
                          }),
                        };
    
    if(typeof messageBody.message_full['additional_params_aps'] != 'undefined'){
        clientMessage['APNS'] = JSON.stringify(messageBody.message_full['additional_params_aps']);
    }


    if(message_full['additional_params']['action_type'] == 'SUSPENDED' || message_full['additional_params']['action_type'] == 'WELCOME_PACK' || message_full['additional_params']['action_type'] == 'ENGAGEMENT_NOTIFICATION_GEOLOC' || message_full['additional_params']['action_type'] =='ENGAGEMENT_NOTIFICATION'){
        if(body.notfType == "SCHEDULED"){
          var scheduledDate = new Date(body.scheduledAt);
          var now = new Date();
          var currentDate = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),  now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
          currentDate.setHours ( currentDate.getHours() + 8 );
          console.log("cur"+currentDate);
          console.log("Sche "+scheduledDate+"cur"+currentDate);
          if(scheduledDate<=currentDate){
            send(params,clientMessage,subject,sns,message);
          }
        }

        if(body.notfType == "IMMEDIATE"){
          send(params,clientMessage,subject,sns,message);
        }

        if(body.notfType == "DAILY"){
          send(params,clientMessage,subject,sns,message);
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
                  sns.deleteEndpoint({'EndpointArn': clientArn}, function(err, data) {
                    if (err) console.log("Error removing Endpoint Arn: "+err); 
                  });
                  message.deleteMessage(function(err, data) {
                    if(err){
                      console.log("Error deleting message: "+err); 
                    }
                    console.log("Deleted ==================: "); 
                    message.next();
                  });
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
          console.log("EndPointResult: "+JSON.stringify(params)); 
          message.deleteMessage(function(err, data) {
            if(err){
              console.log("Error deleting message: "+err); 
            }
            console.log("Deleted ==================: ");
            message.next();
          });
          message.next();
          
        }
        
    });
  };

  
  
  queue.on('error', function (err)
  {
    console.log('There was an error: ', err);
  });

};
