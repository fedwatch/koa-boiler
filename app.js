'use strict';
const Promise = require('bluebird');
const co = Promise.coroutine;
const cluster = require('cluster');

// middleware
const serveStatic = require('koa-static')('public');
const Conditional = require('koa-conditional-get');
const BodyParser = require('koa-bodyparser');
const Compress = require('koa-compress');
const Morgan = require('koa-morgan');
const Favicon = require('koa-favicon');
const session = require('koa-session');
// const adapt = require('koa-adapter'); // adapt pre Koa 2.0 middle ware to be compatible with Koa 2.0.
const adapt = require('koa-adapter-bluebird'); // uses bluebird-co for performance
const helmet = require('koa-helmet');
const etag = require('koa-etag');

const Koa = require('koa');

const app = module.exports = new Koa();

const logger = Morgan('combined');

app.use(Favicon(require.resolve('./public/favicon.ico')));
app.use(require('koa-response-time')());
app.use(Conditional());
app.use(adapt(etag()));
app.use(logger);

app.use(Compress({
    flush: require('zlib').Z_SYNC_FLUSH
}));
app.keys = ['some secret hurr'];

app.use(adapt(session({
    maxAge: 24 * 60 * 60 * 1000 // One Day
}, app)));

app.use(BodyParser({
    // BodyParser options here
}));

class NullOrUndefinedError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
        this.message = message;
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(this, this.constructor);
        } else {
            this.stack = (new Error(message)).stack;
        }
        if (!this.message) {
            this.message = 'Null or undefined error';
        }
    }
};

(function () {
  // Example error handler to JSON stringify errors

  let errorCount = 0; // closure to keep this variable private

  app.use( (ctx, next) => {
      return co(function *() {
          try {
              yield next();
          } catch (err) {
              if (err == null) {
                  err = new NullOrUndefinedError();
              }
              // some errors will have .status
              // however this is not a guarantee
              ctx.status = err.status || 500;
              ctx.type = 'application/json';
              ctx.body = JSON.stringify({
                  errors: [{
                    id: errorCount++,
                    status: ctx.status,
                    title: err.message,
                    detail: err.stack
                  }]
              })

              // since we handled this manually we'll
              // want to delegate to the regular app
              // level error handling as well so that
              // centralized still functions correctly.
              ctx.app.emit('error', err, this);
          }
      })();
  });
})();

const router = require('koa-router')();

router.get('/', (ctx, next) => {
    ctx.status = 200;
    ctx.body = 'Hello world from worker ' + (cluster.worker ? cluster.worker.id : '') + '!';
});

router.get('/api/example', (ctx, next) => {

    return co(function *() {
        yield Promise.delay(3000);
        ctx.response.body = "Simple Async 3-second Delayed Example!";
    })();
});

router.get('/api/error', (ctx, next) => {
    // Example showing error throwing
    throw new Error('Hurr durr!');
});

router.get('/api/nullerror', (ctx, next) => {
    // Example showing error throwing
    throw null;
});

// ejs example
const render = require('koa-ejs');
const path = require('path');

render(app, {
  root: path.join(__dirname, 'view'),
  layout: 'template',
  viewExt: 'html',
  cache: false,
  debug: true
});

// ejs render
router.get('/myip', (ctx, next) => co(function *() {
        ctx.state.ip = ctx.ip;
        yield ctx.render('myip');
    })()
);

// marko render
// http://psteeleidem.com/marko-versus-dust/
const marko = require('marko');

router.get('/marko', (ctx, next) => {
    let ip = ctx.ip;

    let data = {
        ip: ip,
        ip2: co(function *() {
            yield Promise.delay(3000);
            return '3 seconds';
        })(),
        ip3: co(function *() {
            yield Promise.delay(5000);
            return '5 seconds';
        })(),
    };

    // When body is a stream, Koa automatically streams it to the client.
    ctx.body = marko.load(require.resolve('./view/ip.marko')).stream(data);
    ctx.type = 'text/html; charset=utf-8';
});


app.use(router.routes());
app.use(router.allowedMethods());
app.use(adapt(serveStatic));
