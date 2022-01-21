import { relative, resolve } from 'path'
import { spawn } from 'child_process'
import extend from 'extend'
import fetch from 'node-fetch'

const { stringify } = JSON
const { cwd } = process

export default class RIERunner {
  #env = null
  #port = null
  #riePort = null
  #ready = null

  constructor(funOptions, env, options, v3Utils) {
    const { handlerPath } = funOptions
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

    if (v3Utils) {
      this.log = v3Utils.log
      this.progress = v3Utils.progress
      this.writeText = v3Utils.writeText
      this.v3Utils = v3Utils
    }

    this.handlerProcess = spawn(
      'aws-lambda-rie',
      [
        resolve(relative(cwd(), handlerPath), 'bootstrap'),
        '--listen',
        `0.0.0.0:${this.#port}`,
        '--rapid-port',
        this.#riePort, // Dynamically allocated port
      ],
      {
        env: extend(process.env, this.#env),
        shell: true,
      },
    )

    this.#ready = new Promise((ready) => {
      // Wait for ready from RIE
      this.handlerProcess.stderr.once('data', () => {
        ready()
      })
    })

    this.handlerProcess.stderr.on('data', (data) => {
      if (this.log) {
        this.log.info(`RIE: ${data.toString()}`)
      } else {
        console.log(`RIE: ${data.toString()}`)
      }
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
