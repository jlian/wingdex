const previewPattern = /^preview \(#([1-9]\d*)\)$/

function validatePrNumber(prNumber) {
  if (prNumber && !/^[1-9]\d*$/.test(prNumber)) {
    throw new Error('pr_number must be a positive integer or blank')
  }
  if (prNumber && !Number.isSafeInteger(Number(prNumber))) {
    throw new Error('pr_number must be a safe integer')
  }
}

async function discoverPreviewNumbers({ github, context, prNumber }) {
  validatePrNumber(prNumber)
  const environments = prNumber
    ? [{ name: `preview (#${prNumber})` }]
    : await github.paginate(github.rest.repos.getAllEnvironments, {
      ...context.repo,
      per_page: 100,
    })
  return environments
    .filter(environment => previewPattern.test(environment.name))
    .map(environment => environment.name.match(previewPattern)[1])
}

async function cleanupPreviews({ github, context, core, dryRun, prNumber, deleteEnvironments }) {
  if (!prNumber) throw new Error('Cleanup requires one pr_number under its per-PR concurrency group')
  validatePrNumber(prNumber)
  const environment = { name: `preview (#${prNumber})` }
  if (!dryRun && !deleteEnvironments) {
    core.warning('PREVIEW_CLEANUP_TOKEN is not configured: deployments will be deactivated, but environment records will remain. Environment deletion requires Administration: write.')
  }

  const number = Number(prNumber)
  const { data: pr } = await github.rest.pulls.get({
    ...context.repo,
    pull_number: number,
  })
  if (pr.state !== 'closed') {
    core.info(`Skipping ${environment.name}: PR is ${pr.state}.`)
    return
  }

  const deployments = await github.paginate(github.rest.repos.listDeployments, {
    ...context.repo,
    environment: environment.name,
    per_page: 100,
  })
  core.info(`${dryRun ? 'Would deactivate' : 'Deactivating'} ${deployments.length} deployment(s) for ${environment.name}.`)
  if (dryRun) {
    core.info(`Would delete ${environment.name} with PREVIEW_CLEANUP_TOKEN configured.`)
    return
  }

  for (const deployment of deployments) {
    await github.rest.repos.createDeploymentStatus({
      ...context.repo,
      deployment_id: deployment.id,
      state: 'inactive',
      auto_inactive: false,
    })
  }

  if (deleteEnvironments) {
    try {
      await github.rest.repos.deleteAnEnvironment({
        ...context.repo,
        environment_name: environment.name,
      })
      core.info(`Deleted ${environment.name}.`)
    } catch (error) {
      if (error.status !== 404) throw error
      core.info(`${environment.name} is already absent.`)
    }
  }
}

module.exports = { cleanupPreviews, discoverPreviewNumbers }
