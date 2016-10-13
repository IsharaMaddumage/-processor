'use strict';
var mysql = require("mysql");




module.exports.handler = function(event, context, cb) {


    var con = mysql.createConnection({
      host: "test1.crvar51dfth7.ap-southeast-1.rds.amazonaws.com",
      user: "dbuser",
      password: "dbpass!23",
      database : "tenantdb_uat",
      debug: true
    });
    
    
    /*if(con.connect()){
      console.log('true');
    }else{
      console.log('false');
    }*/
    console.log(con.connect());
    
    con.query("select * from devices where id = 1");

    console.log('Hello');

    con.end()


};
