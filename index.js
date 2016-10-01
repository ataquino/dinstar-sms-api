var EventEmitter = require('events').EventEmitter,
    request = require('request'),
    InfiniteLoop = require('infinite-loop');

const 
    SEND_SMS = '/api/send_sms',
    QUERY_SMS_RESULT = '/api/query_sms_result',
    QUERY_INCOMING_SMS = '/api/query_incoming_sms';


var Dinstar = function (host, username, password) {

    var self = this;

    self.host = host;
    self.username = username;
    self.password = password;
    self.url = 'http://' + username + ':' + password + '@' + host;
    
    self.outgoingSms = [];

    self.outgoingResultLoop = new InfiniteLoop();
    self.outgoingResultLoop.add(self.queryOutgoingSmsResult, undefined, self).setInterval(5000).onError(function (error) { console.log(error) });

    self.incomingSmsLoop = new InfiniteLoop();
    self.incomingSmsLoop.add(self.queryIncomingSms, self).setInterval(5000).onError(function (error) { console.log(error) });

    EventEmitter.call(this);
};

Dinstar.prototype.__proto__ = EventEmitter.prototype;

Dinstar.prototype.addToOutgoing = function (messageId, addToFront) {
    var self = this;

    if (addToFront) {
        self.outgoingSms.unshift(messageId);
    } else {
        self.outgoingSms.push(messageId);
    }
};

Dinstar.prototype.sendSms = function (number, message, messageId, sendToSim) {
    var self = this;

    var options = {
        url: self.url + SEND_SMS,
        method: 'POST',
        json: true,
        body: {
            text: message,
            param: [
                {
                    number: number,
                    user_id: messageId
                }
            ]
        }
    };

    if (sendToSim !== undefined && sendToSim !== false) {
        options.body.port = [sendToSim];
    }

    request(options, function (error, response, body) {
        if (!error && response.statusCode === 200) {

            body.messageId = messageId;
            self.emit('message', body);

            if (body.error_code === 202) {

                self.emit('sms_proceeding', body);

                setTimeout(function () {
                    self.addToOutgoing(messageId);
                }, 5000);
            }
        }
    });

    return true;
};

Dinstar.prototype.registerForOutgoingSmsResult = function () {
    this.outgoingResultLoop.run();
};

Dinstar.prototype.unregisterForOutgoingSmsResult = function () {
    this.outgoingResultLoop.stop();
};

Dinstar.prototype.registerForIncomingSms = function () {
    this.incomingSmsLoop.run();
};

Dinstar.prototype.unregisterForIncomingSms = function () {
    this.incomingSmsLoop.stop();
};

Dinstar.prototype.queryOutgoingSmsResult = function (messageId, that) {
    var self = that || this;

    var messageIds = messageId ? [messageId] : self.outgoingSms.splice(0, 32);

    if (messageIds.length > 0) {
        var options = {
            url: self.url + QUERY_SMS_RESULT,
            method: 'POST',
            json: true,
            body: {
                user_id: messageIds
            }
        };

        request(options, function (error, response, body) {
            
            if (!error && response.statusCode === 200) {

                self.emit('message', body);

                if (body.error_code === 200) {

                    for (var i = 0; i < body.result.length; i++) {

                        var result = body.result[i];

                        result.messageId = result.user_id;

                        if (result.status === 'FAILED') {
                            self.emit('sms_error', result);
                        }

                        if (result.status === 'SENT_OK' || result.status === 'DELIVERED') {
                            self.emit('sms_ok', result);
                        }

                        if (result.status !== 'SENDING') {
                            var index = messageIds.indexOf(result.messageId);
                            if (index > -1) {
                                messageIds.splice(index, 1);
                            }
                        }
                    }
                }
            }

            self.outgoingSms.unshift(messageIds);
        });
    }
    
};

Dinstar.prototype.queryIncomingSms = function (that) {
    var self = that || this;

    var options = {
        url: self.url + QUERY_INCOMING_SMS,
        method: 'POST',
        json: true,
        body: {
            flag: 'unread'
        }
    };

    request(options, function (error, response, body) {
        if (!error && response.statusCode === 200) {

            self.emit('message', body);

            if (body.error_code === 200) {

                for (var i = 0; i < body.sms.length; i++) {
                    
                    var sms = body.sms[i];

                    self.emit('cdr_in', sms);
                }
            }
        }
    });
};

module.exports = Dinstar;