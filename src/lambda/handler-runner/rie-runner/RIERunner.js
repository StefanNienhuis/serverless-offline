import { relative, resolve } from 'path'
import { spawn } from 'child_process'
import fetch from 'node-fetch'
import process from 'node:process'
import { log } from '@serverless/utils/log.js'
import { splitHandlerPathAndName } from '../../../utils/index.js'

const { stringify } = JSON
const { cwd } = process

export default class RIERunner {
  #env = null

  #port = null

  #riePort = null

  #ready = null

  constructor(funOptions, env, options) {
    const { handler, codeDir } = funOptions
    const [handlerName] = splitHandlerPathAndName(handler)
    const { portRangeString } = options

    this.#env = env

    const portRange = portRangeString?.split('-') || [59000, 59999]

    if (portRange.length === 2) {
      const minPort = Number(portRange[0])
      const maxPort = Number(portRange[1])

      const isEvenPortCount = (maxPort - minPort) % 2 === 0

      if (minPort != null && maxPort != null && minPort < maxPort) {
        // RIE requires two ports, first one public, second one internal. If port count is odd, subtract one so second port doesn't go out of range.
        this.#port =
          Math.round(
            Math.random() *
              Math.floor((maxPort - !isEvenPortCount - minPort) / 2),
          ) *
            2 +
          minPort
      }
    }

    if (this.#port == null) {
      this.#port = Math.round(Math.random() * 499) * 2 + 59000
    }

    this.#riePort = this.#port + 1

    this.handlerProcess = spawn(
      'aws-lambda-rie',
      [
        resolve(relative(cwd(), codeDir), handlerName, 'bootstrap'),
        '--listen',
        `0.0.0.0:${this.#port}`,
        '--rapid-port',
        this.#riePort, // Dynamically allocated port
      ],
      {
        env: { ...process.env, ...this.#env },
        shell: true,
      },
    )

    this.#ready = new Promise((ready) => {
      // Wait for ready from RIE
      this.handlerProcess.stderr.once('data', () => {
        ready()
      })
    })

    this.handlerProcess.stdout.on('data', (data) => {
      log(`RIE: ${data.toString()}`)
    })

    this.handlerProcess.stderr.on('data', (data) => {
      log(`RIE: ${data.toString()}`)
    })
  }

  // () => void
  cleanup() {
    this.handlerProcess.kill()
  }

  async run(event) {
    await this.#ready

    const url = `http://localhost:${
      this.#port
    }/2015-03-31/functions/function/invocations`

    const res = await fetch(url, {
      body: stringify(event),
      headers: { 'Content-Type': 'application/json' },
      method: 'post',
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch from ${url} with ${res.statusText}`)
    }

    return res.json()
  }
}
