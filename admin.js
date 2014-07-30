/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var express =           require('express');
var cookieParser =      require('cookie-parser');
var bodyParser =        require('body-parser');
var session =           require('express-session');
var AdapterStore =      require(__dirname + '/../../lib/session.js')(session);
var socketio =          require('socket.io');
var password =          require(__dirname + '/../../lib/password.js');
var passport =          require('passport');
var LocalStrategy =     require('passport-local').Strategy;


var app;
var appSsl;
var server;
var serverSsl;
var io;
var ioSsl;

var objects =   {};
var states =    {};

var adapter = require(__dirname + '/../../lib/adapter.js')({
    name:           'admin',
    install: function (callback) {
        if (typeof callback === 'function') callback();
    },
    objectChange: function (id, obj) {
        objects[id] = obj;

        if (io)     io.sockets.emit('objectChange', id, obj);
        if (ioSsl)  ioSsl.sockets.emit('objectChange', id, obj);
    },
    stateChange: function (id, state) {
        states[id] = state;
        if (io)     io.sockets.emit('stateChange', id, state);
        if (ioSsl)  ioSsl.sockets.emit('stateChange', id, state);
    },
    unload: function (callback) {
        try {
            if (server) {
                adapter.log.info("terminating http server");
                server.close();

            }
            if (serverSsl) {
                adapter.log.info("terminating https server");
                serverSsl.close();

            }
            callback();
        } catch (e) {
            callback();
        }
    },
    ready: function () {
        main();
    }
});

function main() {

    adapter.subscribeForeignStates('*');
    adapter.subscribeForeignObjects('*');

    initWebserver();

    getData();

}

function initWebserver() {

    // route middleware to make sure a user is logged in
    function isLoggedIn(req, res, next) {
        if (req.isAuthenticated() || req.originalUrl === '/login/') return next();
        res.redirect('/login/');
    }




    if (adapter.config.listenPort) {
        app    = express();
        if (adapter.config.auth) {

            passport.use(new LocalStrategy(
                function (username, password, done) {

                    adapter.checkPassword(username, password, function (res) {
                        if (res) {
                            return done(null, username);
                        } else {
                            return done(null, false);
                        }
                    });

                }
            ));

            passport.serializeUser(function (user, done) {
                done(null, user);
            });

            passport.deserializeUser(function (user, done) {
                done(null, user);
            });


            app.use(cookieParser());
            app.use(bodyParser.urlencoded({
                extended: true
            }));
            app.use(bodyParser.json());
            app.use(session({
                secret: 'Zgfr56gFe87jJOM',
                saveUninitialized: true,
                resave: true,
                store: new AdapterStore({adapter:adapter})
            }));
            app.use(passport.initialize());
            app.use(passport.session());


            app.post('/login',
                passport.authenticate('local', { successRedirect: '/',
                    failureRedirect: '/login',
                    failureFlash: true })
            );

            app.get('/logout', function (req, res) {
                req.logout();
                res.redirect('/index/login.html');
            });

            app.use(isLoggedIn);


        }
        server = require('http').createServer(app);
    }

    if (adapter.config.listenPortSsl) {
        var fs = require('fs');
        var options;
        try {
            options = {
                key:  fs.readFileSync(__dirname + '/cert/privatekey.pem'),
                cert: fs.readFileSync(__dirname + '/cert/certificate.pem')
            };
        } catch (err) {
            adapter.log.error(err.message);
        }
        if (options) {
            appSsl = express();
            if (adapter.config.auth && adapter.config.authUser) {
                appSsl.use(express.basicAuth(adapter.config.authUser, adapter.config.authPassword));
            }
            serverSsl = require('https').createServer(options, appSsl);
        }
    }

    if (adapter.config.cache) {
        app.use('/', express.static(__dirname + '/www', {maxAge: 30758400000}));
    } else {
        app.use('/', express.static(__dirname + '/www'));
    }

    if (server) {
        var port = adapter.getPort(adapter.config.listenPort, function (port) {
            server.listen(port);
            adapter.log.info("http server listening on port " + port);
            io = socketio.listen(server);
            /*io.set('logger', {
                debug: function(obj) {adapter.log.debug("socket.io: "+obj)},
                info: function(obj) {adapter.log.debug("socket.io: "+obj)} ,
                error: function(obj) {adapter.log.error("socket.io: "+obj)},
                warn: function(obj) {adapter.log.warn("socket.io: "+obj)}
            });*/
            io.on('connection', initSocket);
        });

    }

    if (serverSsl) {
        var portSsl = adapter.getPort(adapter.config.listenPortSsl, function (portSsl) {
            serverSsl.listen(portSsl);
            adapter.log.info("https server listening on port " + portSsl);
            ioSsl = socketio.listen(serverSsl);
            /*io.set('logger', {
                debug: function(obj) {adapter.log.debug("socket.io: "+obj)},
                info: function(obj) {adapter.log.debug("socket.io: "+obj)} ,
                error: function(obj) {adapter.log.error("socket.io: "+obj)},
                warn: function(obj) {adapter.log.warn("socket.io: "+obj)}
            });*/
            ioSsl.on('connection', initSocket);
        });
    }

}

function getData() {
    adapter.log.info('requesting all states');
    adapter.getForeignStates('*', function (err, res) {
        adapter.log.info('received all states');
        states = res;
    });
    adapter.log.info('requesting all objects');
    adapter.objects.getObjectList({include_docs: true}, function (err, res) {
        adapter.log.info('received all objects');
        res = res.rows;
        objects = {};
        for (var i = 0; i < res.length; i++) {
            objects[res[i].doc._id] = res[i].doc;
        }
    });
}

function initSocket(socket) {

    socket.on('getStates', function (callback) {
        callback(null, states);
    });

    socket.on('getObjects', function (callback) {
        callback(null, objects);
    });

    socket.on('setState', function (id, state, callback) {
        if (typeof state !== 'object') state = {val: state};
        adapter.setForeignState(id, state, function (err, res) {
            if (typeof callback === 'function') callback(err, res);
        });
    });

    socket.on('extendObject', function (id, obj, callback) {
        adapter.extendForeignObject(id, obj, function (err, res) {
            if (typeof callback === 'function') callback(err, res);
        });
    });
}

