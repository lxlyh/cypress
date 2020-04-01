/* eslint-disable
    default-case,
    no-unused-vars,
    prefer-rest-params,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const _ = require('lodash')
const sinon = require('sinon')

const Promise = require('bluebird')

const $utils = require('../../cypress/utils')
const $errUtils = require('../../cypress/error_utils')

let counts = null

sinon.setFormatter($utils.stringifyArg.bind($utils))

const createSandbox = () => sinon.createSandbox().usingPromise(Promise)

const display = function (name) {
  switch (name) {
    case 'spy': return 'Spied Obj'
    case 'stub': return 'Stubbed Obj'
  }
}

const formatArgs = (args) => _.map(args, (arg) => $utils.stringifyArg(arg))

const getMessage = function (method, args) {
  if (method == null) {
    method = 'function'
  }

  args = args.length > 3 ?
    formatArgs(args.slice(0, 3)).concat('...')
    :
    formatArgs(args)

  return `${method}(${args.join(', ')})`
}

const onInvoke = function (Cypress, obj, args) {
  let fake
  const {
    agent,
  } = obj
  const agentName = agent._cyName

  // bail if we've turned off logging this agent
  if (agent._log === false) {
    return
  }

  // fakes are children of the agent created with `withArgs`
  const fakes = agent.matchingFakes(args)

  agent._cyLog.set('callCount', agent.callCount)
  for (fake of fakes) {
    fake._cyLog.set('callCount', fake.callCount)
  }

  const logProps = {
    name: agentName,
    message: obj.message,
    error: obj.error,
    type: 'parent',
    end: true,
    snapshot: true,
    event: true,
    consoleProps () {
      const consoleObj = {}

      consoleObj.Command = null
      consoleObj.Error = null
      consoleObj.Event = `${agentName} called`

      consoleObj[agent._cyType] = agent
      consoleObj['Call #'] = agent.callCount
      consoleObj.Alias = agent._cyAlias

      consoleObj[display(obj.name)] = obj.obj
      consoleObj.Arguments = obj.call.args
      consoleObj.Context = obj.call.thisValue
      consoleObj.Returned = obj.call.returnValue

      if (obj.error) {
        consoleObj.Error = obj.error.stack
      }

      for (fake of fakes) {
        const name = fake._cyName
        const count = fake._cyCount

        consoleObj[`Child ${fake._cyType} (${count})`] = '---'
        consoleObj[`  ${count} ${fake._cyType}`] = fake
        consoleObj[`  ${count} call #`] = fake.callCount
        consoleObj[`  ${count} alias`] = fake._cyAlias
        consoleObj[`  ${count} matching arguments`] = fake.matchingArguments
      }

      return consoleObj
    },
  }

  const aliases = _.compact([agent._cyAlias].concat(_.map(fakes, '_cyAlias')))

  if (aliases.length) {
    logProps.alias = aliases
    logProps.aliasType = 'agent'
  }

  return Cypress.log(logProps)
}

const onError = (err) => $errUtils.throwErr(err)

// create a global sandbox
// to be used through all the tests
const sandbox = createSandbox()

const reset = function () {
  counts = {
    spy: 0,
    stub: 0,
    children: {},
  }

  sandbox.restore()

  return null
}

module.exports = function (Commands, Cypress, cy, state, config) {
  // reset initially on a new run because we could be
  // re-running from the UI or from a spec file change
  reset()

  const resetAndSetSandbox = function () {
    reset()

    // attach the sandbox to state
    return state('sandbox', sandbox)
  }

  // before each of our tests we always want
  // to reset the counts + the sandbox
  Cypress.on('test:before:run', resetAndSetSandbox)

  const wrap = function (ctx, type, agent, obj, method, count) {
    if (!count) {
      count = (counts[type] += 1)
    }

    const name = `${type}-${count}`

    if (!agent.parent) {
      counts.children[name] = 0
    }

    const log = Cypress.log({
      instrument: 'agent',
      name,
      type: name,
      functionName: method,
      count,
      callCount: 0,
    })

    agent._cyCount = count
    agent._cyLog = log
    agent._cyName = name
    agent._cyType = type

    const {
      invoke,
    } = agent

    agent.invoke = function (func, thisValue, args) {
      let error = null
      let returned = null

      // because our spy could potentially fail here
      // we need to wrap this in a try / catch
      // so we still emit the command that failed
      // and the user can easily find the error
      try {
        returned = invoke.call(this, func, thisValue, args)
      } catch (e) {
        error = e
      }

      const props = {
        count,
        name: type,
        message: getMessage(method, args),
        obj,
        agent,
        call: agent.lastCall,
        callCount: agent.callCount,
        error,
        log,
      }

      onInvoke(Cypress, props, args)

      // if an error did exist then we need
      // to bubble it up
      if (error) {
        onError(error)
      }

      // make sure we return the invoked return value
      // of the spy
      return returned
    }

    // enable not logging this agent
    agent.log = function (bool = true) {
      agent._log = bool

      return agent
    }

    agent.as = function (alias) {
      cy.validateAlias(alias)
      cy.addAlias(ctx, {
        subject: agent,
        command: log,
        alias,
      })

      agent._cyAlias = alias
      log.set({
        alias,
        aliasType: 'agent',
      })

      agent.named(alias)

      return agent
    }

    const {
      withArgs,
    } = agent

    agent.withArgs = function () {
      const childCount = (counts.children[name] += 1)

      return wrap(ctx, type, withArgs.apply(this, arguments), obj, method, `${count}.${childCount}`)
    }

    return agent
  }

  const spy = function (obj, method) {
    const theSpy = sandbox.spy(obj, method)

    return wrap(this, 'spy', theSpy, obj, method)
  }

  const stub = function (obj, method, replacerFnOrValue) {
    let theStub = sandbox.stub.call(sandbox, obj, method)

    // sinon 2 changed the stub signature
    // this maintains the 3-argument signature so it's not breaking
    if (arguments.length === 3) {
      if (_.isFunction(replacerFnOrValue)) {
        theStub = theStub.callsFake(replacerFnOrValue)
      } else {
        theStub = theStub.value(replacerFnOrValue)
      }
    }

    return wrap(this, 'stub', theStub, obj, method)
  }

  return Commands.addAllSync({
    spy,

    stub,

    agents () {
      $errUtils.warnByPath('agents.deprecated_warning')

      return { stub, spy }
    },
  })
}