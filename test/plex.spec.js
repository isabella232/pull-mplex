/* eslint-env mocha */
/* eslint max-nested-callbacks: ["error", 5] */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(require('chai-checkmark'))
chai.use(dirtyChai)
const sinon = require('sinon')

const pull = require('pull-stream')
const pair = require('pull-pair/duplex')
const abortable = require('pull-abortable')

const coder = require('../src/coder')
const Plex = require('../src/mplex')
const { Types } = require('../src/consts')

const noop = () => {}

describe('plex', () => {
  afterEach(() => {
    sinon.restore()
  })

  it(`destroy should close both ends`, (done) => {
    const p = pair()

    const plex1 = new Plex(true)
    const plex2 = new Plex(false)

    pull(plex1, p[0], plex1)
    pull(plex2, p[1], plex2)

    expect(4).check(done)

    const errHandler = (err) => {
      expect(err.message).to.be.eql('Underlying stream has been closed').mark()
    }
    plex1.on('error', errHandler)
    plex2.on('error', errHandler)

    plex2.on('close', () => {
      expect().mark()
    })

    plex2.on('close', () => {
      expect().mark()
    })
    plex1.destroy()
  })

  it('create stream should create channel with name', () => {
    const plex1 = new Plex()
    sinon.spy(plex1, 'push')
    plex1.createStream()

    expect(plex1.push.callCount).to.eql(1)
    expect(plex1.push.getCall(0).args[0]).to.eql([
      0, Types.NEW, '0'
    ])

    plex1.close()
  })

  it(`closing stream should close all channels`, (done) => {
    const aborter = abortable()
    const plex1 = new Plex()

    plex1.on('error', noop)

    pull(plex1, aborter)

    expect(2).check(done)

    const stream1 = plex1.createStream()
    stream1.on('error', noop)

    const stream2 = plex1.createStream()
    stream2.on('error', noop)
    pull(
      stream1,
      pull.onEnd((err) => {
        expect(err).to.exist().mark()
      })
    )

    pull(
      stream2,
      pull.onEnd((err) => {
        expect(err).to.exist().mark()
      })
    )

    aborter.abort()
  })

  it(`error should propagate to all channels`, (done) => {
    const aborter = abortable()
    const plex1 = new Plex()

    plex1.on('error', noop)

    pull(plex1, aborter)

    expect(2).check(done)

    const stream1 = plex1.createStream()
    stream1.on('error', noop)

    const stream2 = plex1.createStream()
    stream2.on('error', noop)

    pull(
      stream1,
      pull.onEnd((err) => {
        expect(err.message).to.eql('nasty error').mark()
      })
    )

    pull(
      stream2,
      pull.onEnd((err) => {
        expect(err.message).to.eql('nasty error').mark()
      })
    )

    aborter.abort(new Error('nasty error'))
  })

  it.skip(`should fail if max number of channels exceeded`, (done) => {
    const plex1 = new Plex({
      maxChannels: 10,
      lazy: true
    })

    plex1.on('error', (err) => {
      expect(err.message).to.eql('max channels exceeded')
      done()
    })

    for (let i = 0; i < 11; i++) {
      plex1.createStream()
    }
  })

  it(`should restrict message size`, (done) => {
    const plex = new Plex()

    plex.on('error', function (err) {
      expect(err.message).to.equal('message too large!')
      done()
    })

    pull(
      pull.values([Array(1048576 + 2).join('\xff')]), // 1mb
      plex
    )
  })

  it(`should validate message`, (done) => {
    const plex = new Plex()

    plex.on('error', function (err) {
      expect(err.message).to.equal('Invalid message type')
      done()
    })

    pull(
      pull.values([[1, 7]]),
      coder.encode(), // invalid message type
      plex
    )
  })
})
