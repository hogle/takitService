
let Client = require('mariasql'); //https://github.com/mscdex/node-mariasql
let crypto = require('crypto');
let timezoneJS = require('timezone-js');
let express = require('express');
let async = require('async');

let config = require('../config');
let moment = require('moment');
let index = require('./index.js');
let op = require('./op');

let router = express.Router();

var mariaDBConfig = {
    host: config.mariaDB.host,
    user: config.mariaDB.user,     //
    password: config.mariaDB.password,      // Please input your password
    multiStatements: true,
    pingInactive: 300, //in seconds 
    pingWaitRes: 60 //in seconds. time for waiting ping response 
}


var c = new Client(mariaDBConfig);

c.query('set names utf8;');
c.query("use takit;");
c.on('close', function () {
    console.log("DB close c.connected:" + c.connected);
    console.log("DB close c.connecting:" + c.connecting);
}).on('error', function (err) {
    console.log('Client error: ' + err);
}).on('connect', function () {
    console.log('Client connected');
});



var flag;
function performQuery(command, handler) {
    console.log("performQuery with command=" + command + " connected:" + c.connected + " connecting:" + c.connecting + " threadId" + c.threadId);
    if (!c.connected) {                         // Anyother way? It could be dangerous. any mutex? 
        c.connect(mariaDBConfig);
        c.on("ready", function () {
            console.log("mariadb ready");
            c.query('set names utf8;');
            c.query("use takit;");
            c.query(command, handler);
        });
    } else {
        c.query(command, handler);
    }
}

function performQueryWithParam(command, value, handler) {
    console.log("performQuery with command=" + command + " connected:" + c.connected + " connecting:" + c.connecting + " threadId" + c.threadId);
    if (!c.connected) {                         // Anyother way? It could be dangerous. any mutex?
        c.connect(mariaDBConfig);
        c.on("ready", function () {
            console.log("mariadb ready");
            c.query('set names utf8;');
            c.query("use takit;");
            c.query(command, value, handler);
        });
    } else {
        console.log("call c.query with value " + JSON.stringify(value));
        function defaultHandler() {
            console.log("c.query returns");
            flag = true;
            handler();
        }
        console.log("call c.query");
        c.query(command, value, handler);
    }
}


//encrypt data

function encryption(data, pwd) {
    var cipher = crypto.createCipher('aes256', pwd);
    var secretData = cipher.update(data, 'utf8', 'hex');
    secretData += cipher.final('hex');

    return secretData;
}

//decrypt decrepted data

function decryption(secretData, pwd) {
    var decipher = crypto.createDecipher('aes256', pwd);
    var data = decipher.update(secretData, 'hex', 'utf8');
    data += decipher.final('utf8');

    return data;
}

//decrpt userInfo,shopInfo ...etc
function decryptObj(obj) {
    if (obj.hasOwnProperty('referenceId') && obj.referenceId !== null) {
        obj.referenceId = decryption(obj.referenceId, config.rPwd);
    }

    if (obj.hasOwnProperty('email') && obj.email !== null) {
        obj.email = decryption(obj.email, config.ePwd);
    }

    if (obj.hasOwnProperty('phone') && obj.phone !== null) {
        obj.phone = decryption(obj.phone, config.pPwd);
    }

    if (obj.hasOwnProperty('userPhone') && obj.userPhone !== null) {
        obj.userPhone = decryption(obj.userPhone, config.pPwd);
    }

    if (obj.hasOwnProperty('account') && obj.account !== null) {
        obj.account = decryption(obj.account, config.aPwd);
    }
}


router.existUserEmail = function (email, next) {
    var secretEmail = encryption(email, config.ePwd);

    var command = "select *from userInfo where email=?";
    var values = [secretEmail];
    console.log("existUserEmail is called. command:" + command);

    performQueryWithParam(command, values, function (err, result) {
        console.log("c.query success");
        if (err) {
            next(err);
        } else {
            console.dir("[existUser]:" + result.info.numRows);
            if (result.info.numRows === "0") {
                next("invaildId");
            } else {
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });
};

router.existEmailAndPassword = function (email, password, next) {
    let secretEmail = encryption(email, config.ePwd);

    let command = "SELECT userInfo.*, cashId FROM userInfo LEFT JOIN cash ON userInfo.userId = cash.userId WHERE email=?";
    let values = [secretEmail];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            //console.log("[existUser]:"+result.info.numRows);
            if (result.info.numRows === "0") {
                next("invalidId");
            } else {
                console.log(result);
                let userInfo = result[0];
                let secretPassword = crypto.createHash('sha256').update(password + userInfo.salt).digest('hex');

                if (secretPassword === userInfo.password) {
                    console.log("password success!!");
                    decryptObj(userInfo);
                    next(null, userInfo);
                } else {
                    next("passwordFail");
                }
            }
        }
    });
};

router.existUser = function (referenceId, next) {
    let secretReferenceId = encryption(referenceId, config.rPwd);
    let command = "SELECT userInfo.*, cashId FROM userInfo LEFT JOIN cash ON userInfo.userId = cash.userId WHERE referenceId=?";
    let values = [secretReferenceId]
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("query error:" + JSON.stringify(err));
            next(err);
        } else {
            console.dir("[existUser function numRows]:" + result.info.numRows);
            if (result.info.numRows === "0") {
                next("invalidId");
            } else {
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });
};

router.getUserPaymentInfo = function (id, successCallback, errorCallback) {
    var command = "select name,email,phone from userInfo where id=\"" + id + "\";";
    console.log("command:" + command);
    performQuery(command, function (err, result) {
        if (err) {
            console.log(JSON.stringify(err));
            errorCallback(err);
        }
        console.dir("[getUserPaymentInfo]:" + result.info.numRows);
        if (result.info.numRows === "0") {
            errorCallback("invalid DB status");
        } else {
            console.log("result[0]:" + JSON.stringify(result[0]));
            successCallback(result[0]);
        }
    });
};


router.insertUser = function (userInfo, next) {
    console.log("userInfo:" + JSON.stringify(userInfo));

    // referenceId encrypt
    var secretReferenceId = encryption(userInfo.referenceId, config.rPwd);

    var salt;
    var secretPassword = '';

    //1. password encrypt	

    if (!userInfo.hasOwnProperty('password') && userInfo.password === undefined) {
        salt = null;
        secretPassword = null;
    } else {
        salt = crypto.randomBytes(16).toString('hex');
        secretPassword = crypto.createHash('sha256').update(userInfo.password + salt).digest('hex');
    }

    //2. email encrypt
    var secretEmail = encryption(userInfo.email, config.ePwd);

    //3. phone encrypt
    var secretPhone = encryption(userInfo.phone, config.pPwd);

    console.log("secretReferenceId :" + secretReferenceId + " secretEmail : " + secretEmail + " secretPhone:" + secretPhone);

    var command = 'INSERT IGNORE INTO userInfo (referenceId,password,salt,name,email,countryCode,phone,lastLoginTime, receiptIssue,receiptId,receiptType,deviceUuid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)';
    var values = [secretReferenceId, secretPassword, salt, userInfo.name, secretEmail, userInfo.countryCode, secretPhone, new Date().toISOString(), userInfo.receiptIssue, userInfo.receiptId, userInfo.receiptType, userInfo.uuid];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("insertUser func result" + JSON.stringify(result));
            if (result.info.affectedRows === '0') {

                next(null, "duplication")
            } else {
                //console.log(JSON.stringify(result));
                next(null, result.info.insertId);
            }
        }
    });
};

router.validUserwithPhone = function (userId, name, phone, next) {

    let command = "SELECT *FROM userInfo WHERE userId=? and name=? and phone = ?";
    var secretPhone = encryption(phone, config.pPwd);
    let values = [userId, name, secretPhone];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("validUserwithPhone function error:" + JSON.stringify(err));
            next(err);
        } else {
            if (result.info.numRows === "0") {
                next("invalidId");
            } else {
                console.log("validUserwithPhone function success");
                next(null, "validId");
            }
        }
    });
}

router.getUserInfo = function (userId, next) {
    var command = "SELECT *FROM userInfo WHERE userId=?";
    var values = [userId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getUserInfo func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[Get userInfo]:" + result.info.numRows);
            if (result.info.numRows == 0) {
                next(null, {});
            } else {
                console.log("Query succeeded. " + JSON.stringify(result[0]));
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });
}

router.deleteUserInfo = function (userId, next) {
    console.log("userId:" + userId);

    var command = "DELETE FROM userInfo where userId=?"; //userInfo에 shopList 넣기
    var values = [userId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("deleteUserInfo function err:" + err);
            next(err);
        } else {
            console.log("deleteUserInfo function Query succeeded" + JSON.stringify(result));
            next(null);
        }
    });
}

router.updateUserInfo = function (userInfo, next) {
    console.log("update UserInfo function start");
    const values = {};
    values.email = encryption(userInfo.email, config.ePwd);
    values.salt = null;
    values.password = null;
    values.phone = null;
    values.name = userInfo.name;
    values.receiptIssue = userInfo.receiptIssue;
    values.receiptId = userInfo.receiptId;
    values.receiptType = userInfo.receiptType;

    if (userInfo.password !== undefined && userInfo.passsword !== null) {
        values.salt = crypto.randomBytes(16).toString('hex');
        values.password = crypto.createHash('sha256').update(userInfo.password + values.salt).digest('hex');
    }

    if (userInfo.hasOwnProperty('phone') && userInfo.phone !== null && userInfo.phone !== "") {
        values.phone = encryption(userInfo.phone, config.pPwd);
    }

    let command;
    if (userInfo.hasOwnProperty('userId') && userInfo.userId !== null) {
        values.userId = userInfo.userId;
        command = "UPDATE userInfo set password=:password, salt=:salt, email=:email, phone=:phone, name=:name, receiptIssue=:receiptIssue,receiptId=:receiptId,receiptType=:receiptType where userId=:userId";
    } else {
        command = "UPDATE userInfo set password=:password, salt=:salt, receiptIssue=:receiptIssue,receiptId=:receiptId,receiptType=:receiptType where email=:email";
    }

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("updateUserInfo func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.log("Query succeeded. " + JSON.stringify(result));
            next(null, "success");
        }
    });
}

router.updateSessionInfo = function (sessionInfo, next) {
    let command = "UPDATE userInfo set sessionId=:sessionId, lastLoginTime=:lastLoginTime, multiLoginCount=multiLoginCount+:multiLoginCount, deviceUuid=:deviceUuid where userId=:userId";

    performQueryWithParam(command, sessionInfo, function (err, result) {
        if (err) {
            console.log("updateUserInfo func Unable to query. Error:", JSON.stringify(err));
            next(err);
        } else {
            console.log("updateSessionInfo Query succeeded. " + JSON.stringify(result));
            next(null, "success");
        }
    });
};


//shop user 정보 가져옴.

router.existShopUser = function (referenceId, next) {
    console.log("refId:" + referenceId);

    var secretReferenceId = encryption(referenceId, config.rPwd);
    console.log(secretReferenceId);
    var command = "SELECT shopUserInfo.*, name, email FROM shopUserInfo LEFT JOIN userInfo ON shopUserInfo.userId=userInfo.userId where shopUserInfo.referenceId=?";
    var values = [secretReferenceId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("existShopUser function query error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("[existShopUser function numRows]:" + result.info.numRows);

            if (result.info.numRows == "0") {
                next("no shopUser");
            } else {
                //shop이 여러개일 경우에 여러개 리턴
                let shopUserInfos = [];
                result.forEach(function (shopUser) {
                    decryptObj(shopUser);
                    shopUserInfos.push(shopUser);
                });
                console.log("shopUserInfos:" + JSON.stringify(shopUserInfos));
                next(null, shopUserInfos);
            }
        }
    });
}

///////////////여러개 샵 가지고 있으면 여러 레코드 검색됨
router.getShopUserInfo = function (userId, next) {
    let command = "SELECT shopUserInfo.*, name, email FROM shopUserInfo LEFT JOIN userInfo ON shopUserInfo.userId=userInfo.userId WHERE shopUserInfo.userId=?";
    let values = [userId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("shopUserInfo function query error:" + JSON.stringify(err));
            next(err);
        } else {
            console.dir("[shopUserInfo function numRows]:" + result.info.numRows);
            if (result.info.numRows === "0") {
                next("invalidId");
            } else {
                console.log("shopUserInfo success");
                let shopUserInfos = [];
                result.forEach(function (shopUserInfo) {
                    decryptObj(shopUserInfo);
                    shopUserInfos.push(shopUserInfo);
                });

                next(null, shopUserInfos);
            }
        }
    });
}

//userId+takitId 로 한명의 shopUser만 검색

router.updateShopRefId = function (userId, referenceId, next) {

    let secretReferenceId = encryption(referenceId, config.rPwd);
    let command = "UPDATE shopUserInfo set referenceId=? where userId=?";
    let values = [secretReferenceId, userId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("updateShopRefId function result" + JSON.stringify(result));
            next(null);
        }
    });
}

router.insertCashId = function (userId, cashId, password, next) {

    let salt = crypto.randomBytes(16).toString('hex');
    let secretPassword = crypto.createHash('sha256').update(password + salt).digest('hex');

    let command = "INSERT IGNORE INTO cash(userId, cashId, password, salt) values(?,?,?,?)";
    let values = [userId, cashId, secretPassword, salt];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("insertCashId func Unable to query. Error:", JSON.stringify(err));
            next(err);
        } else {
            if (result.info.affectedRows === '0') {
                next(null, "duplicationCashId");
            } else {
                console.log("insertCashId Query succeeded.");
                next(null, "success");
            }
        }
    });
};

router.updateCashPassword = function (userId, cashId, password, next) {

    let salt = crypto.randomBytes(16).toString('hex');
    let secretPassword = crypto.createHash('sha256').update(password + salt).digest('hex');

    let command = "UPDATE cash SET password=?, salt=? WHERE userId=? and cashId=?";
    let values = [secretPassword, salt, userId, cashId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("updateCashPassword func Unable to query. Error:", JSON.stringify(err));
            next(err);
        } else {
            console.log("updateCashPassword Query succeeded.");
            next(null, "success");
        }
    });
}


router.updateRefundCashInfo = function (cashId, amount, balance, next) {
    let command = "UPDATE cash SET balance=balance+?,refundCount=refundCount+1 WHERE cashId = ? and balance=?";
    let values = [amount, cashId, balance];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("updateRefundCashInfo function err:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("updateRefundCashInfo:" + JSON.stringify(result));
            next(null, "success");
        }
    });
}


router.getCashInfo = function (cashId, next) {
    console.log("getCashInfo function start");

    let command = "SELECT *FROM cash WHERE cashId=?";
    let values = [cashId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getCashInfo function err:" + JSON.stringify(err));
            next(err);
        } else {
            if (result.info.numRows === '0') {
                next("invalidId");
            } else {
                console.log(result);
                next(null, result[0]);
            }
        }
    });
}

router.getCashInfoAndPushId = function (cashId, next) {
    console.log("router.getCashInfoAndPushId function start");

    let command = "SELECT cash.*, pushId, platform FROM cash LEFT JOIN userInfo ON cash.userId=userInfo.userId WHERE cashId=?";
    let values = [cashId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
			console.log(err);
            console.log("router.getCashInfoAndPushId err:" + JSON.stringify(err));
            next(err);
        } else {
            if (result.info.numRows === '0') {
                next("invalidId");
            } else {
                console.log(result);
                next(null, result[0]);
            }
        }
    });
}


//cashId를 모를때 userId 통해서 cashId 찾음.
router.getCashId = function (userId, next) {
    console.log("getCashId function start");

    let command = "SELECT cashId FROM cash LEFT JOIN userInfo ON cash.userId=userInfo.userId WHERE cash.userId=?";
    let values = [userId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getCashId function err:" + JSON.stringify(err));
            next(err);
        } else {
            if (result.info.numRows === '0') {
                next("invalid userId");
            } else {
                console.log("getCashId function success");
                next(null, result[0].cashId);
            }
        }
    });
}

router.checkCashPwd = function (cashId, password, next) {
    console.log("checkCashPwd function start");

    let command = "SELECT password, salt FROM cash WHERE cashId=?";
    let values = [cashId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("checkCashPwd function err:" + JSON.stringify(err));
            next(err);
        } else {
            if (result.info.numRows === '0') {
                next("invalid cashId");
            } else {
                console.log("checkCashPwd function success");

                let secretPwd = crypto.createHash('sha256').update(password + result[0].salt).digest('hex');

                console.log("secret:" + secretPwd);
                console.log("pwd:" + result[0].password);
                if (secretPwd === result[0].password) {
                    console.log("correct password");
                    next(null, "correct cashPwd");
                } else {
                    next("invalid cash password");
                }

            }
        }
    });
}


router.findTakitId = function (req, next) {
    console.log("mariaDB.findTakitId " + req.body.hasOwnProperty("servicename") + " " + req.body.hasOwnProperty("shopname"));
    var command;
    if (req.body.hasOwnProperty("servicename") && req.body.hasOwnProperty("shopname")) {
        command = "SELECT serviceName,shopName from takit where serviceName LIKE _utf8\'" + req.body.servicename + "%\' and shopName LIKE _utf8\'" + req.body.shopname + "%\';";
    } else if (req.body.hasOwnProperty("servicename")) {
        command = "SELECT serviceName,shopName from takit where serviceName LIKE _utf8\'" + req.body.servicename + "%\';";
    } else if (req.body.hasOwnProperty("shopname")) {
        command = "SELECT serviceName,shopName from takit where shopName LIKE _utf8\'" + req.body.shopname + "%\';";
    } else {
        console.log("no param");
        next([]);
        return;
    }
    console.log("command:" + command);
    performQuery(command, function (err, result) {
        if (err) {
            console.log("findTakitId Error:" + JSON.stringify(err));
            next(JSON.stringify(err));
        } else {
            console.log("result:" + JSON.stringify(result));
            if (result == undefined) {
                next([]);
            } else {
                console.dir("result:" + result.info.numRows);
                var shoplist = [];
                var idx;
                for (idx = 0; idx < result.info.numRows; idx++) {
                    shoplist.push(result[idx].serviceName + "@" + result[idx].shopName);
                }
                console.log("shoplist:" + JSON.stringify(shoplist));
                next(shoplist);
            }
        }
    });
}


function queryCafeHomeCategory(cafeHomeResponse, req, res) {
    var url_strs = req.url.split("takitId=");
    var takitId = decodeURI(url_strs[1]);
    console.log("takitId:" + takitId);

    console.log(cafeHomeResponse);
    var command = "SELECT *FROM categories WHERE takitId=?";
    var values = [takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("queryCafeHomeCategory function Unable to query. Error:", JSON.stringify(err, null, 2));
            let response = new index.FailResponse(err);
            response.setVersion(config.MIGRATION, req.version);
            res.send(JSON.stringify(response));
        } else {
            if (result.info.numRows == 0) {
                console.log("[queryCafeHomeCategory categories]:" + result.info.numRows);
                let response = new index.FailResponse("query failure");
                response.setVersion(config.MIGRATION, req.version);
                res.send(JSON.stringify(response));
            } else {
                console.log("queryCafeHomeCategory func Query succeeded. " + JSON.stringify(result));

                var categories = [];
                result.forEach(function (item) {
                    console.log(JSON.stringify(item));
                    categories.push(item);
                });

                cafeHomeResponse.categories = categories;
                console.log("cafeHomeResponse:" + (JSON.stringify(cafeHomeResponse)));
                console.log("send res");
                res.end(JSON.stringify(cafeHomeResponse));

            }
        }
    });
}


function queryCafeHomeMenu(cafeHomeResponse, req, res) {
    console.log("req url:" + req.url);

    var url_strs = req.url.split("takitId=");
    var takitId = decodeURI(url_strs[1]);
    console.log(":takitId" + takitId);

    var menus = [];

    var command = "SELECT *FROM menus WHERE menuNO LIKE '" + takitId + "%'";
    console.log("queryCafeHomeMenu command:" + command);
    performQuery(command, function (err, result) {
        if (err) {
            console.error("queryCafeHomeMenu func Unable to query. Error:", JSON.stringify(err, null, 2));
            let response = new index.SuccResponse();
            response.setVersion(config.MIGRATION, req.version);
            res.send(JSON.stringify(response));
        } else {
            console.dir("[Get cafeHomeMenu]:" + result.info.numRows);
            if (result.info.numRows == 0) {
                let response = new index.FailResponse("query failure");
                response.setVersion(config.MIGRATION, req.version);
                res.send(JSON.stringify(response));
            } else {
                console.log("queryCafeHomeMenu Query succeeded. " + JSON.stringify(result[0]));

                var menus = [];
                result.forEach(function (item) {
                    console.log(JSON.stringify(item));
                    menus.push(item);
                });

                cafeHomeResponse.menus = menus;
                queryCafeHomeCategory(cafeHomeResponse, req, res);

            }
        }
    });
}


router.queryCafeHome = function (req, res) {
    console.log("queryCafeHome:" + JSON.stringify(req.url));
    var url_strs = req.url.split("takitId=");
    var takitId = decodeURI(url_strs[1]);
    console.log("takitId:" + takitId);
    let cafeHomeResponse = new index.SuccResponse();
    cafeHomeResponse.setVersion(config.MIGRATION, req.version);

    var command = "select *from shopInfo where takitId=?";
    var values = [takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            let response = new index.FailResponse(err);
            response.setVersion(config.MIGRATION, req.version);
            res.send(JSON.stringify(response));
        } else {
            if (result.info.numRows === "0") {
                console.log("queryCafeHome function's query failure");
                let response = new index.FailResponse("query failure");
                response.setVersion(config.MIGRATION, req.version);
                res.send(JSON.stringify(response));
            } else {
                result.forEach(function (item) {
                    delete item.account;
                    console.log(JSON.stringify(item));
                    cafeHomeResponse.shopInfo = item;
                    queryCafeHomeMenu(cafeHomeResponse, req, res);
                });
            }
        }
    });
};

function queryCafeHomeCategoryPost(cafeHomeResponse, req, res) {
    var takitId = req.body.takitId;
    console.log("takitId:" + takitId);

    console.log(cafeHomeResponse);
    var command = "SELECT *FROM categories WHERE takitId=?";
    var values = [takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("queryCafeHomeCategory function Unable to query. Error:", JSON.stringify(err, null, 2));
            let response = new index.FailResponse(err);
            response.setVersion(config.MIGRATION, req.version);
            res.send(JSON.stringify(response));
        } else {
            if (result.info.numRows == 0) {
                console.log("[queryCafeHomeCategory categories]:" + result.info.numRows);
                let response = new index.FailResponse("query failure");
                response.setVersion(config.MIGRATION, req.version);
                res.send(JSON.stringify(response));
            } else {
                console.log("queryCafeHomeCategory func Query succeeded. " + JSON.stringify(result));

                var categories = [];
                result.forEach(function (item) {
                    console.log(JSON.stringify(item));
                    categories.push(item);
                });

                cafeHomeResponse.categories = categories;
                console.log("cafeHomeResponse:" + (JSON.stringify(cafeHomeResponse)));
                console.log("send res");
                res.end(JSON.stringify(cafeHomeResponse));

            }
        }
    });
}

function queryCafeHomeMenuPost(cafeHomeResponse, req, res) {
    console.log("req url:" + req.url);

    var takitId = req.body.takitId;
    console.log(":takitId" + takitId);

    var menus = [];

    var command = "SELECT *FROM menus WHERE menuNO LIKE '" + takitId + "%'";
    console.log("queryCafeHomeMenu command:" + command);
    performQuery(command, function (err, result) {
        if (err) {
            console.error("queryCafeHomeMenu func Unable to query. Error:", JSON.stringify(err, null, 2));
            let response = new index.SuccResponse();
            response.setVersion(config.MIGRATION, req.version);
            res.send(JSON.stringify(response));
        } else {
            console.dir("[Get cafeHomeMenu]:" + result.info.numRows);
            if (result.info.numRows == 0) {
                let response = new index.FailResponse("query failure");
                response.setVersion(config.MIGRATION, req.version);
                res.send(JSON.stringify(response));
            } else {
                console.log("queryCafeHomeMenu Query succeeded. " + JSON.stringify(result[0]));

                var menus = [];
                result.forEach(function (item) {
                    console.log(JSON.stringify(item));
                    menus.push(item);
                });

                cafeHomeResponse.menus = menus;
                queryCafeHomeCategoryPost(cafeHomeResponse, req, res);

            }
        }
    });
}

router.queryCafeHomePost = function (req, res) {
    console.log("queryCafeHomePost:" + JSON.stringify(req.url));
    var takitId = req.body.takitId;
    console.log("takitId:" + takitId);
    let cafeHomeResponse = new index.SuccResponse();
    cafeHomeResponse.setVersion(config.MIGRATION, req.version);

    var command = "select *from shopInfo where takitId=?";
    var values = [takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            let response = new index.FailResponse(err);
            response.setVersion(config.MIGRATION, req.version);
            res.send(JSON.stringify(response));
        } else {
            if (result.info.numRows === "0") {
                console.log("queryCafeHome function's query failure");
                let response = new index.FailResponse("query failure");
                response.setVersion(config.MIGRATION, req.version);
                res.send(JSON.stringify(response));
            } else {
                result.forEach(function (item) {
                    delete item.account;
                    console.log(JSON.stringify(item));
                    cafeHomeResponse.shopInfo = item;
                    queryCafeHomeMenuPost(cafeHomeResponse, req, res);
                });
            }
        }
    });
};

//shopList string으로 저장..
router.updateShopList = function (userId, shopList, next) {

    console.log("updateUserInfoShopList - userId:" + userId);

    let command = "UPDATE userInfo SET shopList=? where userId=?"; //userInfo에 shopList 넣기
    let values = [shopList, userId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("updateUserInfoShopList function Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.log("updateUserInfoShopList func Query succeeded. " + JSON.stringify(result));
            next(null);
        }
    });
};


//pushId
router.updatePushId = function (userId, token, platform, next) {
    var command = "UPDATE userInfo SET pushId=?, platform=? WHERE userId=?";
    var values = [token, platform, userId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("updatePushId func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.log("updatePushId func Query succeeded. " + JSON.stringify(result));
            console.log(result);
            next(null, "success");
        }
    });
};

router.removeSessionInfo = function (userId, pushId, platform, sessionId, next) {
    let command = "UPDATE userInfo SET pushId=?, platform=?, sessionId=? WHERE userId=?";
    let values = [pushId, platform, sessionId, userId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("updatePushId func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.log("updatePushId func Query succeeded. " + JSON.stringify(result));
            console.log(result);
            next(null, "success");
        }
    });
}

router.getPushId = function (userId, next) {
    let command = "select pushId,platform,SMSNoti from userInfo WHERE userId=?";
    let values = [userId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getPushId func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            if (result.info.numRows == 0) {
                next("not exsit pushId");
            } else {
                console.log("getPushId func Query succeeded. " + JSON.stringify(result[0]));
                next(null, result[0]);
            }
        }
    });
};




router.updateShopPushId = function (userId, takitId, shopToken, platform, next) {
    var command = "UPDATE shopUserInfo SET shopPushId=?,platform=? WHERE userId=? AND takitId=?";
    var values = [shopToken, platform, userId, takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("updateShopPushId func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.log("updateShopPushId func Query succeeded. " + JSON.stringify(result));
            next(null, "success");
        }
    });
};


router.getShopPushId = function (takitId, next) {

    let command = "SELECT shopUserInfo.userId, shopPushId, shopUserInfo.platform, phone, myShopList from shopUserInfo"
        + " LEFT JOIN userInfo on shopUserInfo.userId = userInfo.userId WHERE takitId=? and GCMNoti=?"
    let values = [takitId, "on"];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getShopPushId func Unable to query. Error:", JSON.stringify(err));
            next(err);
        } else {
            console.log("[getShopPushid func get shopPushId]:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next("not exist shopUser");
            } else {
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });
}


router.updateShopBusiness = function (takitId, flag, next) {
    console.log("enter updateShopBusiness function");
    let command = "UPDATE shopInfo SET business=? WHERE takitId=?";
    let values = [flag, takitId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("updateShopBusiness func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.log("updateShopBusiness result:" + JSON.stringify(result));
            next(null, "success");
        }
    });
}

//SMS Noti 끄기
router.changeSMSNoti = function (userId, flag, next) {
    console.log("comes changeSMSNoti function");

    let command = "UPDATE userInfo SET SMSNoti=? where userId=?";
    let values = [flag, userId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("changeSMSNoti func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.log("changeSMSNoti Query succeeded. " + JSON.stringify(result));
            next(null);
        }
    });

}


router.getShopInfo = function (takitId, next) {  // shopInfo 조회해서 next로 넘겨줌.

    console.log("enter getShopInfo function");
    var command = "SELECT *FROM shopInfo WHERE takitId =?";
    var values = [takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getShopInfo func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[exist shopInfo]:" + result.info.numRows);
            if (result.info.numRows === "0") {
                next("inexistant shop");
            } else {
                delete result[0].account;
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });
}

router.getShopInfoWithAccount = function (takitId, next) {  // shopInfo 조회해서 next로 넘겨줌.

    console.log("enter getShopInfo function");
    var command = "SELECT *FROM shopInfo WHERE takitId =?";
    var values = [takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getShopInfo func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[exist shopInfo]:" + result.info.numRows);
            if (result.info.numRows === "0") {
                next("inexistant shop");
            } else {
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });
}

router.getDiscountRate = function (takitId, next) {
    console.log("enter getDiscountRate function");
    let command = "SELECT discountRate FROM shopInfo WHERE takitId=?";
    let values = [takitId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getDiscountRate func Unable to query. Error:", JSON.stringify(err));
            next(err);
        } else {
            console.dir("[getDiscountRate in shopInfo]:" + result.info.numRows);
            if (result.info.numRows === "0") {
                next("inexistant shop");
            } else {
                next(null, result[0].discountRate);
            }
        }
    });

};

router.getAccountShop = function (takitId, next) {
    console.log("enter getAccountShop function");
    let command = "SELECT account,bankName,bankCode,depositer FROM shopInfo WHERE takitId =?";
    let values = [takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getAccountShop func Unable to query. Error:", JSON.stringify(err));
            next(err);
        } else {
            console.dir("[exist getAccountShop]:" + result.info.numRows);
            if (result.info.numRows === "0") {
                next("incorrect takitId");
            } else {
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });
}

router.updateNotiMember = function (userId, takitId, onMyShopList, offMyShopList, next) {
    let command = "UPDATE shopUserInfo SET GCMNoti=(case when userId=? then 'on'"
        + "else 'off' end),"
        + "myShopList=(case when userId=? then ? "
        + "else ? end)where takitId=?";
    /*if userId 가 맞으면 'manager'로 변경
       else userId가 맞지 않고, if class==='manager' 이면(기존 manager인 사람) 'member'로 변경
                "          , else 나머지는 'member'
       */
    let values = [userId, userId, onMyShopList, offMyShopList, takitId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log(result);
            next(null, "success");
        }
    });
};

//increaseOrderNumber function orderNumberCounter 수 증가 시키고, 마지막 주문 시간 재 설정.
function increaseOrderNumber(takitId, orderNumberCounterTime, next) {

    var command;
    var values;
    if(orderNumberCounterTime===null){
        command = "UPDATE shopInfo SET orderNumberCounter=orderNumberCounter+1,orderNumberCounterTime=? WHERE takitId=? and orderNumberCounterTime IS NULL";
        values = [new Date().toISOString(), takitId];
    }else{
        command = "UPDATE shopInfo SET orderNumberCounter=orderNumberCounter+1,orderNumberCounterTime=? WHERE takitId=? and orderNumberCounterTime=?";
        values = [new Date().toISOString(), takitId, orderNumberCounterTime];
    }

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("increaseOrderNumber func Unable to query. Error:", JSON.stringify(err, null, 2))
            next(err);
        } else {
            console.log("increaseOrderNumber func Query succeeded. " + JSON.stringify(result));
            (result.info.affectedRows === "0") 
            ? next("can't update orderNumberCounter") 
            : next(null);
        }
    });
}  //increaseOrderNumber function end.


router.getOrderNumber = function (shopInfo, next) {
    
    //orderNumberCounter = 오늘 주문수 계속 카운트.
    //orderNumberCounterTime = 가장 마지막으로 주문받은 시간 저장. => 오늘의 가장 첫 주문 확인 시에 필요.

    console.log("shopInfo in getOrderNumber:" + shopInfo);
    console.log("current orderNumberCounter:" + shopInfo.orderNumberCounter);
    console.log("current orderNuberTime:" + shopInfo.orderNumberCounterTime);

    //매일 카운트 수 리셋. orderNO도 리셋 하기 위한 작업.

    let timezone = shopInfo.timezone;   // 각 shop의 timezone
    let utcTime = new Date();
    let localTime; // 현재 localTime
    let counterLocalTime; //counterTime의 localTime
    let oldCounterTime = 0; // orderNumberCounterTime null이면 0 이전 counterTime

    if (shopInfo.orderNumberCounterTime !== null) {
        let counterTime = new Date(Date.parse(shopInfo.orderNumberCounterTime + " GMT"));
        console.log("first order time(counter time) : " + counterTime.toISOString());
        localTime = op.getTimezoneLocalTime(timezone, utcTime).toISOString(); //현재 시간의 localTime 계산
        counterLocalTime = op.getTimezoneLocalTime(timezone, counterTime).toISOString(); //이전의 orderNumberCounterTime(UTC로 저장되어 있음)의 로컬시간 계산.
        oldCounterTime = shopInfo.orderNumberCounterTime; //orderNumberCounterTime 시간이 있으면 이전 시간으로 저장.
        console.log("localTime:" + localTime.substring(0, 10));
        console.log("counterLocalTime:" + counterLocalTime.substring(0, 10));
    }


    //shop's default orderNumberCounter=0 and first order just let it 
    if(shopInfo.orderNumberCounterTime !== null && localTime.substring(0, 10) !== counterLocalTime.substring(0, 10)){
        var command = "UPDATE shopInfo SET orderNumberCounter=?, orderNumberCounterTime=? WHERE takitId=? and orderNumberCounterTime=?";
        var values = [1, utcTime.toISOString(), shopInfo.takitId, oldCounterTime];
        //orderNumberCounter를 하루의 시작 0으로 리셋

        performQueryWithParam(command, values, function (err, result) {
            if (err) {
                console.log("getOrderNumber func set orderNumberCounter with condition " + err);
                next(err);
            } else {
                console.dir("[getOrderNumber func update orderNumberCounter]:" + result.info.numRows);
                (result.info.affectedRows === '0') 
                ? next("can't update shopInfo") 
                : next(null, 1);
                
            }
        });// end update orderNumberCounterTime
   
        //counterLocaltime이 어제 주문한 시간이라 localTime과 맞지 않으면(다음날이 된 경우) reset 돼야함

        // set orderNumberCounter as zero and then increment it
        console.log("reset orderNumberCounter")

    } else { //같은 날의 주문일 경우 or shop's first order
        increaseOrderNumber(shopInfo.takitId,shopInfo.orderNumberCounterTime, function (err,result) {
            err 
            ? next(err) 
            : next(null,parseInt(shopInfo.orderNumberCounter)+1);
        });
    }
};

router.saveOrder = function (order, shopInfo, next) {
    console.log("[order:" + JSON.stringify(order) + "]");
    console.log("order's takeout:" + order.takeout);
    //1. user 검색
    router.getUserInfo(order.userId, function (err, userInfo) {
        if(err){
            next(err);
        }else{
        //2. order insert

        //3. encrypt phone
            let secretUserPhone = encryption(userInfo.phone, config.pPwd);
            let command = "INSERT INTO orders(takitId,orderName,payMethod,amount,takeout,orderNO,userId,userName,userPhone,orderStatus,orderList,orderedTime,localOrderedTime,localOrderedDay,localOrderedHour,localOrderedDate,receiptIssue,receiptId,receiptType) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

            let values = [order.takitId, order.orderName, order.paymethod, order.amount, order.takeout, order.orderNO, userInfo.userId, userInfo.name, secretUserPhone, order.orderStatus, order.orderList, order.orderedTime, order.localOrderedTime, order.localOrderedDay, order.localOrderedHour, order.localOrderedDate, userInfo.receiptIssue, userInfo.receiptId, userInfo.receiptType];
            performQueryWithParam(command, values, function (err, orderResult) {
                if (err) {
                    console.error("saveOrder func inser orders Unable to query. Error:", JSON.stringify(err, null, 2));
                    next(err);
                } else {
                    //console.dir("[Add orders]:"+result);
                    if (orderResult.info.affectedRows === '0') {
                        next("invalid orders");
                    } else {
                        console.log("saveOrder func Query succeeded. " + JSON.stringify(orderResult));
                        // 3.orderList insert
                        let command = "INSERT INTO orderList(orderId,menuNO,menuName,quantity,options,amount) values(?,?,?,?,?,?)";
                        let orderList = JSON.parse(order.orderList);

                        let i=0;
                        async.whilst(function(){return i<orderList.menus.length;
                        },function(callback){
                            console.log("menus length:" + orderList.menus.length);
                            let menu = orderList.menus[i];
                            let values = [orderResult.info.insertId, menu.menuNO, menu.menuName, menu.quantity, JSON.stringify(menu.options),
                                         (orderList.menus.length > 1) ? menu.discountAmount : menu.price];
                    
                            performQueryWithParam(command, values, function (err, result) {
                                if (err) {
                                    console.error("saveOrder func insert orderList Unable to query. Error:", JSON.stringify(err, null, 2));
                                    callback(err);
                                } else {
                                    console.log("saveOrder func insert orderList Query Succeeded");
                                    callback(null,"success");
                                    i++;
                                }
                            });
                        },function(err,result){
                            err 
                            ? next(err) 
                            : next(null,orderResult.info.insertId);
                        })        
                    }
                }
            });
        }
    });
};


//orderId로 order 검색할때
router.getOrder = function (orderId, next) {

    var command = "SELECT *FROM orders WHERE orderId=?";
    var values = [orderId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getOrder func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[getOrder func Get MenuInfo]:" + result.info.numRows);
            if (result.info.numRows == 0) {
                next("not exist order");
            } else {
                console.log("getOrder func Query succeeded. " + JSON.stringify(result.info));
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });

}



//user가 주문내역 검색할 때,
router.getOrdersUser = function (userId, takitId, lastOrderId, limit, next) {
    console.log("takitId:" + takitId);
    var command;
    var values;

    if (lastOrderId == -1) {
        command = "SELECT *FROM orders WHERE userId=? AND takitId=? AND orderId > ?  ORDER BY orderId DESC LIMIT " + limit;

    } else {
        command = "SELECT *FROM orders WHERE userId=? AND takitId=? AND orderId < ?  ORDER BY orderId DESC LIMIT " + limit;
    }

    values = [userId, takitId, lastOrderId];

    //해당 user와 shop에 맞는 orders 검색	
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getOrdersUser func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[getOrdersUser func Get MenuInfo]:" + result.info.numRows);
            if (result.info.numRows == 0) {
                next(null, result.info.numRows);
            } else {
                console.log("getOrdersUser func Query succeeded. " + JSON.stringify(result.info));

                var orders = [];

                result.forEach(function (order) {
                    decryptObj(order);
                    orders.push(order);
                });

                next(null, orders);
            }
        }
    })

}

router.getLocalTimeWithOption = function (option, timezone) {
    let startTime = op.getTimezoneLocalTime(timezone, new Date()).toISOString().substring(0, 11) + "00:00:00.000Z";
	console.log(startTime);
    let localStartTime = new Date(Date.parse(startTime));
    let offset = (new timezoneJS.Date(new Date(), timezone)).getTimezoneOffset(); // offset in minutes
    let queryStartTime;

	console.log(startTime)
    if (option === "today") {
        let todayStartTime = new Date(localStartTime.getTime() + (offset * 60 * 1000));
        console.log("todayStartTime in gmt:" + todayStartTime.toISOString());
        queryStartTime = todayStartTime.toISOString();
    } else if (option === "week") {
        let weekStartTime = new Date(localStartTime.getTime() - 24 * 60 * 60 * 6 * 1000 + (offset * 60 * 1000));
        console.log("weekStartTime in gmt:" + weekStartTime.toISOString());
        queryStartTime = weekStartTime.toISOString();
    } else if (option === "month") {
        let tomorrow = new Date(localStartTime.getTime() + (offset * 60 * 1000));
        let monthAgo = moment(tomorrow).subtract(1, 'M').toDate();
        queryStartTime = monthAgo.toISOString();
    } else {
        return;
    }
    return queryStartTime;
}


//shop에서 주문내역 검색할 때
router.getOrdersShop = function (takitId, option, lastOrderId, limit, next) {
    console.log("takitId:" + takitId);

    function queryOrders(startTime) {
        if (lastOrderId == -1) {

            var command = "SELECT *FROM orders WHERE takitId=? AND orderedTime > ? AND orderId > ?  ORDER BY orderId DESC LIMIT " + limit;
        } else {
            var command = "SELECT *FROM orders WHERE takitId=? AND orderedTime > ? AND orderId < ?  ORDER BY orderId DESC LIMIT " + limit;
        }
        var values = [takitId, startTime, lastOrderId];
        performQueryWithParam(command, values, function (err, result) {
            if (err) {
                console.error("queryOrders func Unable to query. Error:", JSON.stringify(err, null, 2));
                next(err);
            } else {
                console.dir("[queryOrders func Get MenuInfo]:" + result.info.numRows);
                if (result.info.numRows == 0) {
                    next("not exist orders");
                } else {
                    console.log("queryOrders func Query succeeded. " + JSON.stringify(result.info));

                    var orders = [];
                    result.forEach(function (order) {
                        decryptObj(order);
                        orders.push(order);
                    });

                    next(null, orders);
                }
            }
        });
    } //end queryOrders


    var command = "SELECT *FROM shopInfo WHERE takitId=?";
    var values = [takitId];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getOrdersShop func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[getOrdersShop func Get shopInfo]:" + result.info.numRows);
            if (result.info.numRows == 0) {
                next("not exist shop");
            } else {
                console.log("getOrdersShop func Query succeeded. " + JSON.stringify(result));
                console.log("timezone:" + result[0].timezone);

                let queryStartTime = router.getLocalTimeWithOption(option, result[0].timezone);

                console.log("queryStartTime:" + queryStartTime);
                queryOrders(queryStartTime);
            }
        }
    });
};


router.getPeriodOrdersShop = function (takitId, startTime, endTime, lastOrderId, limit, next) {
    console.log("takitId:" + takitId + " startTime:" + startTime + " end:" + endTime);

    if (lastOrderId == -1) {
        var command = "SELECT *FROM orders WHERE takitId=? AND orderedTime BETWEEN ? AND ? AND orderId > ?  ORDER BY orderId DESC LIMIT " + limit;
    } else {
        var command = "SELECT *FROM orders WHERE takitId=? AND orderedTime BETWEEN ? AND ? AND orderId < ?  ORDER BY orderId DESC LIMIT " + limit;
    }
    var values = [takitId, startTime, endTime, lastOrderId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getPeriodOrders func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[getPeriodOrders func Get MenuInfo]:" + result.info.numRows);

            if (result.info.numRows == 0) {
                next("not exist orders");
            } else {
                console.log("getPeriodOrders func Query succeeded. " + JSON.stringify(result.info));
                var orders = [];
                result.forEach(function (order) {
                    decryptObj(order);
                    orders.push(order);
                });

                next(null, orders);
            }
        }
    });


};



//order's noti mode 에서 필요한 order를 가져옴.
router.getOrdersNotiMode = function (userId, next) {
    console.log("getOrdersNotiMode comes!!!");

    let currentTime = new Date();
    console.log(currentTime);
    let currentTimeStr = currentTime.toISOString().substring(0, 19).replace('T', ' ');
    let yesterDayTime = new Date(currentTime.getTime() - 86400000) // 86400000 = 하루 만큼의 milliseconds
    console.log(yesterDayTime);
    let yesterDayTimeStr = yesterDayTime.toISOString().substring(0, 19).replace('T', ' ');

    console.log("getOrdersNotiMode comes!!!");
    let command = "SELECT *FROM orders WHERE userId=? and orderedTime >= ? and orderedTime <= ? and (orderStatus=? or orderStatus=?)";
    let values = [userId, yesterDayTimeStr, currentTimeStr, "paid", "checked"];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log(result);

            let orders = [];
            result.forEach(function (order) {
                decryptObj(order);
                orders.push(order);
            })

            next(null, orders);
        }
    });
};





router.updateOrderStatus = function (orderId, oldStatus, nextStatus, timeName, timeValue, cancelReason, timezone, next) {
    console.log("oldStatus:" + oldStatus + " nextStatus:" + nextStatus);
    //현재 db에 저장된 주문상태,   새로 update할 주문상태
    //timeName is checkedTime, completeTime, canceledTime ...

    var command = "SELECT orderStatus FROM orders WHERE orderId=?";  //orderStatus와 oldStatus 같은지 비교하기 위해 조회함. 
    var values = [orderId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("updateOrderStatus func  Unable to query. Error:", JSON.stringify(err, null, 2));
            ext(err);
        } else {
            console.dir("[updateOrderStatus func]:" + result.info.numRows);
            if (result.info.numRows == 0) {
                next("not exist order");
            } else {
                console.log("updateOrderStatus func Query succeeded. " + JSON.stringify(result));

                values = {};

                //orderStatus === oldStatus 이면 update 실행. 다르면 실행x
                if (result[0].orderStatus === oldStatus || oldStatus === '' || oldStatus === null) {
                    command = "UPDATE orders SET orderStatus=:nextStatus," + timeName + "=:timeValue, cancelReason=:cancelReason , localCancelledTime=:localCancelledTime WHERE orderId=:orderId";
                    values.nextStatus = nextStatus,
                        values.timeValue = timeValue.toISOString(),
                        values.orderId = orderId,
                        values.cancelReason = null;

                    //cancelled 상태면 이유 넣음. 아니면 그대로 null
                    if (nextStatus === 'cancelled') {
                        values.cancelReason = cancelReason;
                        values.localCancelledTime = op.getTimezoneLocalTime(timezone, timeValue);
                    }
                } else {
                    next("incorrect old orderStatus");
                }


                performQueryWithParam(command, values, function (err, result) {
                    if (err) {
                        console.error("updateOrderStatus func Unable to query. Error:", JSON.stringify(err, null, 2));
                        next(err);
                    } else {
                        console.dir("[updateOrderStatus func Get MenuInfo]:" + result.info.affectedRows);
                        if (result.info.affectedRows == 0) {
                            next("can't update orders");
                        } else {
                            console.log("updateOrderStatus func Query succeeded. " + JSON.stringify(result[0]));
                            next(null, "success");
                        }
                    }
                });
            }

        }

    });

};


//////// 매출 및 통계 API /////////

router.getSales = function (takitId, startTime, next) {
    //select sum(amount) from orders where takitId = "세종대@더큰도시락" and orderedTime < "2016-12-28";
    console.log("takitId:" + takitId);

    let command = "SELECT SUM(amount) AS sales FROM orders WHERE takitId=? AND orderedTime > ?";
    let values = [takitId, startTime];
    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("querySales func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[querySales func Get MenuInfo]:" + result.info.numRows);
            if (result.info.numRows == 0) {
                next(null, 0);
            } else {
                console.log("querySales func Query succeeded. " + JSON.stringify(result.info));
                next(null, result[0].sales);
            }
        }
    });
}

router.getSalesPeriod = function (takitId, startTime, endTime, next) {
    console.log("takitId:" + takitId + " startTime:" + startTime + " end:" + endTime);

    let command = "SELECT SUM(amount) AS sales FROM orders WHERE takitId=? AND orderedTime BETWEEN ? AND ?" //startTime과 endTime 위치 중요!!
    let values = [takitId, startTime, endTime];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getSalesPeriod func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            console.dir("[getSalesPeriod func Get MenuInfo]:" + result.info.numRows);

            if (result.info.numRows == 0) {
                next(null, 0);
            } else {
                console.log("getSalesPeriod func Query succeeded. " + JSON.stringify(result.info));
                next(null, result[0].sales);
            }
        }
    });
}

router.getStatsMenu = function (takitId, startTime, next) {
    //select menuName, SUM(quantity) FROM orderList where menuNO LIKE \'"+takitId+"%\'GROUP BY menuName";
    console.log("getStatsMenu comes");

    let command = "SELECT menuName, SUM(quantity) AS count, SUM(orderList.amount) AS menuSales FROM orderList LEFT JOIN orders ON orderList.orderId=orders.orderId WHERE menuNO LIKE'" + takitId + "%' AND orderedTime > ? GROUP BY menuName"
    let values = [startTime];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getStatsMenu func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            if (result.info.numRows == 0) {
                next(null, 0);
            } else {
                console.log("getStatsMenu func Query succeeded. " + JSON.stringify(result.info));
                delete result.info;
                next(null, result);
            }
        }
    });
}

router.getPeriodStatsMenu = function (takitId, startTime, endTime, next) {
    console.log("getPeriodStatsMenu comes");

    let command = "SELECT menuName, SUM(quantity) AS count, SUM(orderList.amount) AS menuSales FROM orderList LEFT JOIN orders ON orderList.orderId=orders.orderId WHERE menuNO LIKE'" + takitId + "%' AND orderedTime BETWEEN ? AND ? GROUP BY menuName";
    let values = [startTime, endTime];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.error("getPeriodStatsMenu func Unable to query. Error:", JSON.stringify(err, null, 2));
            next(err);
        } else {
            if (result.info.numRows == '0') {
                console.log(result.info.numRows);
                next("can't not find stats");
            } else {
                console.log("getPeriodStatsMenu func Query succeeded. " + JSON.stringify(result.info));
                delete result.info;
                next(null, result);
            }
        }
    });
}

////////////매출 및 통계 end////////////



//////////////cash /////////////////

router.getCashInfo = function (cashId, next) {
    console.log("getCashInfo function start");

    let command = "SELECT *FROM cash WHERE cashId=?";
    let values = [cashId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getCashInfo function err:" + JSON.stringify(err));
            next(err);
        } else {
            if (result.info.numRows === '0') {
                next("invalidId");
            } else {
                console.log(result);
                decryptObj(result[0]);
                next(null, result[0]);
            }
        }
    });

}

router.updateBalanceCash = function (cashId, amount, balance, next) {

    let command = "UPDATE cash SET balance=balance+? WHERE cashId =? and balance=?";
    let values = [amount, cashId, balance];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("updateBalanceCash function err:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("updateBalanceCash:" + JSON.stringify(result));
            if (amount !== 0 && result.info.affectedRows === "0") {
                next("already checked cash");
            } else {
                next(null, "success");
            }
        }
    });
};


router.getBalanceCash = function (cashId, next) {

    let command = "SELECT balance FROM cash WHERE cashId = ?";
    let values = [cashId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getBalanceCash function err:" + JSON.stringify(err));
            next(err);
        } else {
            if (result.info.numRows === "0") {
                next("incorrect cashId");
            } else {
                console.log("getBalanceCash:" + JSON.stringify(result));
                next(null, result[0].balance);
            }
        }
    });
}

router.insertCashList = function (cashList, next) {
    console.log("insertCashList comes");

    if (cashList.account !== undefined) {
        cashList.account = encryption(cashList.account, config.aPwd);
    }

    let command = "INSERT INTO cashList(cashId,transactionType,amount,fee, nowBalance,transactionTime,depositTime, bankCode,bankName ,account,confirm)" +
        "VALUES(:cashId,:transactionType,:amount,:fee, :nowBalance,:transactionTime,:depositTime,:bankCode,:bankName, :account,:confirm)";

    performQueryWithParam(command, cashList, function (err, result) {
        if (err) {
            console.log("insertCashList function err:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("insertCashList:" + JSON.stringify(result));
            next(null, result.info.insertId);
        }
    });
}


router.getCashList = function (cashId, lastTuno, limit, next) {
    console.log("mariaDB.getCashList start!!");

    let command;
    if (lastTuno == -1) {
        command = "SELECT * FROM cashList WHERE cashId =? AND cashTuno > ? AND transactionType!='wrong' ORDER BY cashTuno DESC LIMIT " + limit;
    } else {
        command = "SELECT * FROM cashList WHERE cashId =? AND cashTuno < ? AND transactionType!='wrong' ORDER BY cashTuno DESC LIMIT " + limit;
    }
    let values = [cashId, lastTuno];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getCashList function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next(null, "0");
            } else {
                console.log("getCashList find cashList");
                delete result.info;
                for (let i = 0; i < result.length; i++) {
                    if (result[i].account !== null) {
                        decryptObj(result[i]);
                    }
                }
                next(null, result);
            }
        }
    });
}

router.updateCashList = function (cashList, next) {
    console.log("mariaDB.updateCashList start!!");

    let command = "UPDATE cashList SET cashId=:cashId,transactionType=:transactionType, transactionTime=:transactionTime, confirm=:confirm, nowBalance=:nowBalance WHERE cashTuno=:cashTuno";

    performQueryWithParam(command, cashList, function (err, result) {
        if (err) {
            console.log("updateCashList function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            next(null, "success");
        }
    });
}

router.updateTransactionType = function (cashTuno, type, next) {
    console.log("mariaDB.updateTransactionType start!!");
    let command = "UPDATE cashList SET transactionType=? where cashTuno=?";
    let values = [cashTuno, type];


    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getCashList function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            next(null, "success");
        }
    });
}

router.getCashListWithTuno = function (cashTuno, next) {
    console.log("mariaDB.getCashList start!!");

    let command = "SELECT * FROM cashList where cashTuno = ?"
    let values = [cashTuno];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getCashListwithTuno function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next("invalid cashTuno");
            } else {
                console.log("getCashListwithTuno find cashList");
                next(null, result[0]);
            }
        }
    });
}


router.getDepositedCash = function (cashList, next) {
    console.log("mariaDB.getDepositedCash start!!");

    console.log("cashList:" + JSON.stringify(cashList));
	let command = "SELECT * FROM cashList WHERE transactionType='deposit' and confirm=0 and cashId =:depositMemo and bankCode=:bankCode "
                    +"and amount=:amount and depositTime like '"+cashList.depositTime.substring(0,13)+"%'";

	
    // let tomorrowTime = new Date(cashList.depositTime.getTime()+86400000).toISOString();
    // let yesterDayTime = new Date(cashList.depositTime.getTime()-86400000).toISOString(); //86400000 24시간 만큼의 milliseconds
    // console.log(tomorrowTime);
    // console.log(yesterDayTime);

    // //입금시각이 23인 경우 다음날의 날짜로도 검색
    // if(cashList.depositHour ===23){

    //     command = "SELECT * FROM cashList WHERE transactionType='deposit' and confirm=0 and cashId =:depositMemo and bankCode=:bankCode "
    //               +"and amount=:amount and (depositTime like '"+cashList.depositDate+"%' or depositTime like '"+tomorrowTime.substring(0,10)+"%')";
    // //입금시각이 00시인 경우 전 날짜로도 검색
    // }else if(cashList.depositHour === 0){
    //     command = "SELECT * FROM cashList WHERE transactionType='deposit' and confirm=0 and cashId =:depositMemo and bankCode=:bankCode "
    //               +"and amount=:amount and (depositTime like '"+cashList.depositDate+"%' or depositTime like '"+yesterDayTime.substring(0,10)+"%')";

    // }

    performQueryWithParam(command, cashList, function (err, result) {
        if (err) {
			console.log(err);
            console.log("mariaDB.getDepositedCash function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next("incorrect depositor");
            } else {
                console.log("getDepositedCash find cashList");
                delete result.info;
                next(null, result);
            }
        }
    });
}



router.getPushIdWithCashId = function (cashId, next) {
    console.log("getPushIdWithCashId:" + cashId);
    let command = "SELECT pushId, platform FROM userInfo LEFT JOIN cash ON userInfo.userId=cash.userId WHERE cashId=?";
    let values = [cashId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getPushIdWithCashId function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next(null, "incorrect cashId");
            } else {
                console.log("getPushIdWithCashId function success");
                next(null, result[0]);
            }
        }
    });
}

router.getBankName = function(bankCode,next){
   let command = "SELECT bankName FROM bankInfo where bankCode =?";
   let values = [bankCode];

   performQueryWithParam(command, values, function(err,result){
      if(err){
         console.log("getBankName function Error:"+JSON.stringify(err));
         next(err);
      }else{
         console.log("result:"+JSON.stringify(result));
         if(result.info.numRows === '0'){
            next("incorrect bankCode");
         }else{
            console.log("getBankName function success");
            next(null,result[0].bankName);
         }
      }
   });
}

/*router.getBankName = function (branchCode, next) {
    console.log("getBankName start");
    let command = "SELECT bankName, branchName FROM bank WHERE branchCode LIKE \'" + branchCode.substring(0, 6) + "%\'";
    let values = [branchCode];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getBankName function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("getBankName result:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next("incorrect branchCode");
            } else {
                console.log("getBankName function success");
                next(null, result[0]);
            }
        }
    });
};*/


router.findBranchName = function (branchName, bankName, next) {
    console.log("mariaDB.findBranchName " + branchName, "and bankName " + bankName);
    let command = "SELECT branchCode, branchName FROM bank WHERE branchName LIKE _utf8 \'" + branchName + "%\' and bankName LIKE _utf8 \'" + bankName + "%\'";

    performQuery(command, function (err, result) {
        if (err) {
            console.log("findBranchName Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next(null, []);
            } else {
                console.dir("findBranchName result:" + result.info.numRows);
                delete result.info;
                next(null, result);
            }
        }
    });
}

router.updateConfirmCount = function (cashId, confirmCount, next) {
    console.log("updateConfirmCount start confirmCount:" + confirmCount);
    let command = "UPDATE cash SET confirmCount=? WHERE cashId=?";
    let values = [confirmCount, cashId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("updateConfirmCount function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("updateConfirmCount result:" + JSON.stringify(result));
            next(null, result[0]);
        }
    });
}


//shop-cash
router.updateSalesShop = function (takitId, amount, next) {
    console.log("updateShopSales start");
    let command = "UPDATE shopInfo SET sales=sales+?,balance=balance+? WHERE takitId=?";
    let values = [amount, amount, takitId];


    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("updateSalesShop function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("updateSalesShop result:" + JSON.stringify(result));
            next(null, "success");
        }
    });
}

router.updateWithdrawalShop = function (takitId, amount, balance, next) {
    let command = "UPDATE shopInfo SET balance=balance+?,withdrawalCount=withdrawalCount+1 WHERE takitId=? and balance=?";
    let values = [amount, takitId, balance];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("updateConfirmCount function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("updateConfirmCount result:" + JSON.stringify(result));
            next(null, "success");
        }
    });
}

router.updateBalanceShop = function (takitId, amount, next) {
    let command = "UPDATE shopInfo SET balance=balance+? WHERE takitId=?";
    let values = [amount, takitId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("updateBalanceShop function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("updateBalanceShop result:" + JSON.stringify(result));
            next(null, "success");
        }
    });
}

router.getBalnaceShop = function (takitId, next) {
    console.log("mariaDB.getBalnaceShop start!!");

    let command = "SELECT sales,balance FROM shopInfo where takitId = ?"
    let values = [takitId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getBalnaceShop function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next("invalid takitId");
            } else {
                console.log("getBalnaceShop find cashList");
                next(null, result[0]);
            }
        }
    });
}

router.insertWithdrawalList = function (takitId, amount, fee, nowBalance, next) {

    console.log("mariaDB.insertWithdrawalList start!!");

    let command = "INSERT INTO withdrawalList(takitId,amount,fee,nowBalance,withdrawalTime) VALUES(?,?,?,?,?)"
    let values = [takitId, amount, fee, nowBalance, new Date().toISOString()];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("insertWithdrawalList function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            next(null, result.info.insertId);
        }
    });
}

router.getWithdrawalList = function (takitId, lastWithdNO, limit, next) {
    console.log("mariaDB.getWithdrawalList start!!");

    let command;
    if (lastWithdNO == -1) {
        command = "SELECT * FROM withdrawalList WHERE takitId =? AND withdNO > ? ORDER BY withdNO DESC LIMIT " + limit;
    } else {
        command = "SELECT * FROM withdrawalList WHERE takitId =? AND withdNO < ? ORDER BY withdNO DESC LIMIT " + limit;
    }
    let values = [takitId, lastWithdNO];


    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log("getWithdrawalList function Error:" + JSON.stringify(err));
            next(err);
        } else {
            console.log("result:" + JSON.stringify(result));
            if (result.info.numRows === '0') {
                next(null, '0');
            } else {
                console.log("getWithdrawalList success");
                delete result.info;
                next(null, result);
            }
        }
    });
}


router.insertTakitId = function (takitId, next) {
    let command = "INSERT INTO takit VALUES(:serviceName,:shopName)";

    performQueryWithParam(command, takitId, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("insertTakitId success");
            next(null, "success");
        }
    });
}

router.insertCategory = function (category, next) {
    let command = "INSERT INTO categories VALUES(:takitId,:categoryNO,:categoryName,:categoryNameEn)";

    performQueryWithParam(command, category, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("insertCategory success");
            next(null, "success");
        }
    });
}

router.updateCategory = function (category, next) {
    let command = "UPDATE categories SET ";
    //WHERE takitId=? categoryNO=?";
    let keys = Object.keys(category);
    for (let i = 0; i < keys.length; i++) {
        if (category[keys[i]] !== "") {
            command += keys[i] + "=:" + keys[i] + ", ";
        }
    }
    command += "WHERE takitId=:takitId and categoryNO=:categoryNO";
    console.log(typeof command);
    command = command.replace(", WHERE", " WHERE");
    console.log(command);

    performQueryWithParam(command, category, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("updateCategory success");
            next(null, "success");
        }
    });
};

//shop user 정보 가져옴.


router.insertMenu = function (menu, next) {
    let command = "INSERT INTO menus VALUES(:menuNO,:menuName,:explanation,:price,:options,:takeout,:imagePath,:requiredTime,:menuNameEn,:explanationEn,:optionsEn)";

    performQueryWithParam(command, menu, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("updateCategory success");
            next(null, "success");
        }
    });
};

router.updateMenu = function (menu, next) {
    let command = "UPDATE menus SET ";
    //WHERE takitId=? categoryNO=?";
    let keys = Object.keys(menu);

    console.log(keys);
    for (let i = 0; i < keys.length; i++) {
        if (menu[keys[i]] !== "" && [keys[i]] !== 'newMenuNO' && [keys[i]] !== "newMenuName") {
            command += keys[i] + "=:" + keys[i] + ", ";
        } else if (keys[i] === "newMenuNO" && keys['newMenuNO'] !== "") {
            command += "menuNO" + "=:" + keys[i] + ", ";
        } else if (keys[i] === "newMenuName" && keys['newMenuName'] !== "") {
            command += "menuName" + "=:" + keys[i] + ", ";
        }
    }


    command += "WHERE menuNO=:menuNO and menuName=:menuName";
    console.log(typeof command);
    command = command.replace(", WHERE", " WHERE");
    console.log(command);


    performQueryWithParam(command, menu, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("updateCategory success");
            next(null, "success");
        }
    });
};

router.insertShopInfo = function (shopInfo, next) {
    let command = "INSERT INTO shopInfo(";

    let keys = Object.keys(shopInfo);
    for (let i = 0; i < keys.length; i++) {
        if (shopInfo[keys[i]] !== "") {
            command += keys[i] + ",";
        }
    }
    command += "VALUES(";
    command = command.replace(",VALUES", ") VALUES");

    for (let i = 0; i < keys.length; i++) {
        if (shopInfo[keys[i]] !== "") {
            command += ":" + keys[i] + ",";
        }
    }
    command += ")";
    command = command.replace(",)", ")");

    performQueryWithParam(command, shopInfo, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("insertShopInfo success");
            next(null, "success");
        }
    });
}

router.updateShopInfo = function (shopInfo, next) {
    let command = "UPDATE categories SET ";

    let keys = Object.keys(shopInfo);
    for (let i = 0; i < keys.length; i++) {
        if (shopInfo[keys[i]] !== "") {
            command += keys[i] + "=:" + keys[i] + ", ";
        }
    }
    command += "WHERE takitId=:takitId";
    console.log(typeof command);
    command = command.replace(", WHERE", " WHERE");
    console.log(command);

    performQueryWithParam(command, shopInfo, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("updateshopInfo success");
            next(null, "success");
        }
    });
};

router.getMenus = function (takitId, categoryNO, next) {
    let command = "select *from menus where menuNO=?";
    let values = [];
    values[0] = takitId + ";" + categoryNO;

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("updateshopInfo success");
            console.log(result);
            delete result.info;
            next(null, result);
        }
    });
}

router.getCategories = function (takitId, categoryNO, next) {
    let command = "select *from categories where categoryNO=? and takitId=?";
    let values = [categoryNO, takitId];

    performQueryWithParam(command, values, function (err, result) {
        if (err) {
            console.log(err);
            next(err);
        } else {
            console.log("updateshopInfo success");
            console.log(result);
            delete result.info;
            next(null, result);
        }
    });
}


router.updateMenusWithNO = function (takitId, categoryNO) {

    let categories = {};
    let menus = [];
    router.getCategories(takitId, categoryNO + 1, function (err, result) {
        if (!err) {
            categories = result[0];

            router.getMenus(takitId, categoryNO, function (err, result) {
                if (!err) {
                    menus = result;
                    console.log("getName susccess:" + JSON.stringify(menus));
                    for (let i = 0; i < menus.length; i++) {
                        let command = "UPDATE menus SET menuNO=:newMenuNO,imagePath=:iamgePath where menuNO=:menuNO and menuName=:menuName";
                        let values = {};
                        values.newMenuNO = takitId + ";" + (categoryNO + 1);
                        values.iamgePath = takitId + ";" + (categoryNO + 1) + "_" + menus[i].menuName;
                        values.menuNO = takitId + ";" + categoryNO;
                        values.menuName = menus[i].menuName;
                        performQueryWithParam(command, values, function (err, result) {
                            if (err) {
                                console.log(err);
                            } else {
                                console.log(result);
                                console.log("updateshopInfo success");
                            }
                        });
                    }
                }
            });
        }
    });
}

//router.updateMenusWithNO("세종대@더큰도시락",13);

module.exports = router;
