/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)

const concat = require('concat-stream')
const through = require('through2')
const net = require('net')
const chunky = require('chunky')
const pump = require('pump')
const toStream = require('pull-stream-to-stream')

const MplexCore = require('libp2p-mplex/src/internals')
const Plex = require('../src')

describe('node stream multiplex interop', () => {
  it('new2old: one way piping work with 2 sub-streams', (done) => {
    const pullPlex = new Plex(true)
    const plex1 = toStream(pullPlex)
    const stream1 = toStream(pullPlex.createStream())
    const stream2 = toStream(pullPlex.createStream())

    function onStream (stream, id) {
      stream.pipe(collect())
    }

    const plex2 = new MplexCore({ initiator: false }, onStream)

    plex1.pipe(plex2)

    stream1.write(Buffer.from('hello'))
    stream2.write(Buffer.from('world'))
    stream1.end()
    stream2.end()

    let pending = 2
    const results = []

    function collect () {
      return concat(function (data) {
        results.push(data.toString())

        if (--pending === 0) {
          results.sort()
          expect(results[0].toString()).to.equal('hello')
          expect(results[1].toString()).to.equal('world')
          done()
        }
      })
    }
  })

  it('old2new: one way piping work with 2 sub-streams', (done) => {
    const plex1 = new MplexCore()
    const stream1 = plex1.createStream()
    const stream2 = plex1.createStream()

    function onStream (pullStream, id) {
      const stream = toStream(pullStream)
      stream.pipe(collect())
    }

    const pullPlex = new Plex(onStream)
    const plex2 = toStream(pullPlex)

    plex1.pipe(plex2)

    stream1.write(Buffer.from('hello'))
    stream2.write(Buffer.from('world'))
    stream1.end()
    stream2.end()

    let pending = 2
    const results = []

    function collect () {
      return concat(function (data) {
        results.push(data.toString())

        if (--pending === 0) {
          results.sort()
          expect(results[0].toString()).to.equal('hello')
          expect(results[1].toString()).to.equal('world')
          done()
        }
      })
    }
  })

  it('new2old: two way piping works with 2 sub-streams', (done) => {
    const pullPlex = new Plex(true)
    const plex1 = toStream(pullPlex)

    const plex2 = new MplexCore(function onStream (stream, id) {
      const uppercaser = through(function (chunk, e, callback) {
        this.push(Buffer.from(chunk.toString().toUpperCase()))
        this.end()
        callback()
      })
      stream.pipe(uppercaser).pipe(stream)
    })

    plex1.pipe(plex2).pipe(plex1)

    const stream1 = toStream(pullPlex.createStream())
    const stream2 = toStream(pullPlex.createStream())

    stream1.pipe(collect())
    stream2.pipe(collect())

    stream1.write(Buffer.from('hello'))
    stream2.write(Buffer.from('world'))

    let pending = 2
    const results = []

    function collect () {
      return concat(function (data) {
        results.push(data.toString())
        if (--pending === 0) {
          results.sort()
          expect(results[0].toString()).to.equal('HELLO')
          expect(results[1].toString()).to.equal('WORLD')
          done()
        }
      })
    }
  })

  it('old2new: two way piping works with 2 sub-streams', (done) => {
    const plex1 = new MplexCore()

    const plex2 = toStream(new Plex(false, function onStream (pstream, id) {
      const stream = toStream(pstream)
      const uppercaser = through(function (chunk, e, callback) {
        this.push(Buffer.from(chunk.toString().toUpperCase()))
        this.end()
        callback()
      })
      stream.pipe(uppercaser).pipe(stream)
    }))

    plex1.pipe(plex2).pipe(plex1)

    const stream1 = plex1.createStream()
    const stream2 = plex1.createStream()

    stream1.pipe(collect())
    stream2.pipe(collect())

    stream1.write(Buffer.from('hello'))
    stream2.write(Buffer.from('world'))

    let pending = 2
    const results = []

    function collect () {
      return concat(function (data) {
        results.push(data.toString())
        if (--pending === 0) {
          results.sort()
          expect(results[0].toString()).to.equal('HELLO')
          expect(results[1].toString()).to.equal('WORLD')
          done()
        }
      })
    }
  })

  it.skip('destroy', (done) => {
    const pullPlex = new Plex()
    const plex1 = toStream(pullPlex)

    const stream1 = toStream(pullPlex.createStream())

    const plex2 = new MplexCore(function onStream (stream, id) {
      stream.on('error', function (err) {
        expect(err.message).to.equal('0 had an error')
        done()
      })
    })

    plex1.pipe(plex2)

    stream1.write(Buffer.from('hello'))
    // pull-stream-to-stream destroy doesn't take parameters, so error never gets emited
    stream1.destroy(new Error('0 had an error'))
  })

  // need to implement message size checks
  it.skip('testing invalid data error', (done) => {
    const plex = toStream(new Plex())

    plex.on('error', function (err) {
      if (err) {
        expect(err.message).to.equal('Incoming message is too big')
        done()
      }
    })
    // a really stupid thing to do
    plex.write(Array(50000).join('\xff'))
  })

  // need to implement message size checks
  it.skip('overflow', (done) => {
    let count = 0

    function check () {
      if (++count === 2) {
        done()
      }
    }

    const plex1 = new MplexCore()
    const plex2 = new MplexCore({ limit: 10 })

    plex2.on('stream', function (stream) {
      stream.on('error', function (err) {
        expect(err.message).to.equal('Incoming message is too big')
        check()
      })
    })

    plex2.on('error', function (err) {
      if (err) {
        expect(err.message).to.equal('Incoming message is too big')
        check()
      }
    })

    plex1.pipe(plex2).pipe(plex1)

    const stream = plex1.createStream()

    stream.write(Buffer.alloc(11))
  })

  it('2 buffers packed into 1 chunk', (done) => {
    const pullPlex = new Plex(true)
    const plex1 = toStream(pullPlex)

    const plex2 = new MplexCore(function (b) {
      b.pipe(concat(function (body) {
        expect(body.toString('utf8')).to.equal('abc\n123\n')
        server.close()
        plex1.end()
        done()
      }))
    })

    const a = toStream(pullPlex.createStream(1337))
    a.write('abc\n')
    a.write('123\n')
    a.end()

    const server = net.createServer(function (stream) {
      plex2.pipe(stream).pipe(plex2)
    })
    server.listen(0, function () {
      const port = server.address().port
      plex1.pipe(net.connect(port)).pipe(plex1)
    })
  })

  it('chunks', (done) => {
    let times = 100
    ;(function chunk () {
      const collect = collector(function () {
        if (--times === 0) {
          done()
        } else {
          chunk()
        }
      })

      const plex1 = new MplexCore()
      const stream1 = plex1.createStream()
      const stream2 = plex1.createStream()

      const plex2 = new MplexCore(function onStream (stream, id) {
        stream.pipe(collect())
      })

      plex1.pipe(through(function (buf, enc, next) {
        const bufs = chunky(buf)
        for (let i = 0; i < bufs.length; i++) this.push(bufs[i])
        next()
      })).pipe(plex2)

      stream1.write(Buffer.from('hello'))
      stream2.write(Buffer.from('world'))
      stream1.end()
      stream2.end()
    })()

    function collector (cb) {
      let pending = 2
      const results = []

      return function () {
        return concat(function (data) {
          results.push(data.toString())
          if (--pending === 0) {
            results.sort()
            expect(results[0].toString()).to.equal('hello')
            expect(results[1].toString()).to.equal('world')
            cb()
          }
        })
      }
    }
  })

  it('prefinish + corking', (done) => {
    const plex = new MplexCore()
    let async = false

    plex.on('prefinish', function () {
      plex.cork()
      process.nextTick(function () {
        async = true
        plex.uncork()
      })
    })

    plex.on('finish', function () {
      expect(async).to.be.ok()
      done()
    })

    plex.end()
  })

  it('quick message', (done) => {
    const plex2 = new MplexCore()
    const plex1 = new MplexCore(function (stream) {
      stream.write('hello world')
    })

    plex1.pipe(plex2).pipe(plex1)

    setTimeout(function () {
      const stream = plex2.createStream()
      stream.on('data', function (data) {
        expect(data).to.eql(Buffer.from('hello world'))
        done()
      })
    }, 100)
  })

  it('half close a muxed stream', (done) => {
    const plex1 = new MplexCore()
    const plex2 = new MplexCore()

    plex1.pipe(plex2).pipe(plex1)

    plex2.on('stream', function (stream, id) {
      expect(stream).to.exist()
      expect(id).to.exist()

      // let it flow
      stream.on('data', function () {})

      stream.on('end', function () {
        done()
      })

      stream.on('error', function (err) {
        expect(err).to.not.exist()
      })

      stream.write(Buffer.from('hello world'))

      stream.end()
    })

    const stream = plex1.createStream()

    stream.on('data', function (data) {
      expect(data).to.eql(Buffer.from('hello world'))
    })

    stream.on('error', function (err) {
      expect(err).to.not.exist()
    })

    stream.on('end', function () {
      stream.end()
    })
  })

  it('half close a half closed muxed stream', (done) => {
    const plex1 = new MplexCore({ halfOpen: true })
    const plex2 = new MplexCore({ halfOpen: true })

    plex1.nameTag = 'plex1:'
    plex2.nameTag = 'plex2:'

    plex1.pipe(plex2).pipe(plex1)

    plex2.on('stream', function (stream, id) {
      expect(stream).to.exist()
      expect(id).to.exist()

      stream.on('data', function (data) {
        expect(data).to.eql(Buffer.from('some data'))
      })

      stream.on('end', function () {
        stream.write(Buffer.from('hello world'))
        stream.end()
      })

      stream.on('error', function (err) {
        expect(err).to.not.exist()
      })
    })

    const stream = plex1.createStream()

    stream.on('data', function (data) {
      expect(data).to.eql(Buffer.from('hello world'))
    })

    stream.on('error', function (err) {
      expect(err).to.not.exist()
    })

    stream.on('end', function () {
      done()
    })

    stream.write(Buffer.from('some data'))

    stream.end()
  })

  it('underlying error is propagated to muxed streams', (done) => {
    let count = 0

    function check () {
      if (++count === 4) {
        done()
      }
    }

    const plex1 = new MplexCore()
    const plex2 = new MplexCore()

    let socket

    plex2.on('stream', function (stream) {
      stream.on('error', function (err) {
        expect(err).to.exist()
        check()
      })

      stream.on('close', function () {
        check()
      })

      socket.destroy()
    })

    const stream1to2 = plex1.createStream(1337)

    stream1to2.on('error', function (err) {
      expect(err).to.exist()
      check()
    })

    stream1to2.on('close', function () {
      check()
    })

    const server = net.createServer(function (stream) {
      pump(plex2, stream)
      pump(stream, plex2)
      server.close()
    })

    server.listen(0, function () {
      const port = server.address().port
      socket = net.connect(port)

      pump(plex1, socket)
      pump(socket, plex1)
    })
  })
})
