import * as core from '@actions/core'
import * as fs from 'fs'
import {backOff} from 'exponential-backoff'
import {v4 as uuid} from 'uuid'
import {
  getConfig,
  DispatchMethod,
  ActionOutputs,
  getBackoffOptions
} from './action'
import * as api from './api'
import {getDispatchedWorkflowRun} from './utils'
import axios, {isAxiosError} from 'axios'

const DISTINCT_ID = uuid()

async function validateSubscription(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'lasith-kg/dispatch-workflow'
  const action = process.env.GITHUB_ACTION_REPOSITORY
  const docsUrl =
    'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions'

  core.info('')
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m')
  core.info(`Secure drop-in replacement for ${upstream}`)
  if (repoPrivate === false)
    core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m')
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`)
  core.info('')

  if (repoPrivate === false) return

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
  const body: Record<string, string> = {action: action || ''}
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      {timeout: 3000}
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
        `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`
      )
      core.error(
        `\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`
      )
      process.exit(1)
    }
    core.info('Timeout or API not reachable. Continuing to next step.')
  }
}

async function run(): Promise<void> {
  try {
    await validateSubscription()
    const config = getConfig()
    api.init(config)
    const backoffOptions = getBackoffOptions(config)

    // Display Exponential Backoff Options (if debug mode is enabled)
    core.info(`🔄 Exponential backoff parameters:
    starting-delay: ${backoffOptions.startingDelay}
    max-attempts: ${backoffOptions.numOfAttempts}
    time-multiple: ${backoffOptions.timeMultiple}`)

    // Get the workflow ID if give a string
    if (typeof config.workflow === 'string') {
      const workflowFileName = config.workflow
      core.info(`⌛ Fetching workflow id for ${workflowFileName}`)
      const workflowId = await backOff(
        async () => api.getWorkflowId(workflowFileName),
        backoffOptions
      )
      core.info(`✅ Fetched workflow id: ${workflowId}`)
      config.workflow = workflowId
    }

    // Dispatch the action using the chosen dispatch method
    if (config.dispatchMethod === DispatchMethod.WorkflowDispatch) {
      await api.workflowDispatch(DISTINCT_ID)
    } else {
      await api.repositoryDispatch(DISTINCT_ID)
    }

    // Exit Early Early if discover is disabled
    if (!config.discover) {
      core.info('✅ Workflow dispatched! Skipping the retrieval of the run-id')
      return
    }

    core.info(
      `⌛ Fetching run-ids for workflow with distinct-id=${DISTINCT_ID}`
    )

    const dispatchedWorkflowRun = await backOff(async () => {
      const workflowRuns = await api.getWorkflowRuns()
      const dispatchedWorkflowRun = getDispatchedWorkflowRun(
        workflowRuns,
        DISTINCT_ID
      )
      return dispatchedWorkflowRun
    }, backoffOptions)

    core.info(`✅ Successfully identified remote run:
    run-id: ${dispatchedWorkflowRun.id}
    run-url: ${dispatchedWorkflowRun.htmlUrl}`)
    core.setOutput(ActionOutputs.RunId, dispatchedWorkflowRun.id)
    core.setOutput(ActionOutputs.RunUrl, dispatchedWorkflowRun.htmlUrl)
  } catch (error) {
    if (error instanceof Error) {
      core.warning('🟠 Does the token have the correct permissions?')
      error.stack && core.debug(error.stack)
      core.setFailed(`🔴 Failed to complete: ${error.message}`)
    }
  }
}

run()
