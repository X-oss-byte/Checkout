import * as assert from 'assert'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as github from '@actions/github'
import * as https from 'https'
import * as io from '@actions/io'
import * as path from 'path'
import * as refHelper from './ref-helper'
import * as retryHelper from './retry-helper'
import * as toolCache from '@actions/tool-cache'
import {ExecOptions} from '@actions/exec/lib/interfaces'
import {IncomingMessage} from 'http'
import {RequestOptions, ReposGetArchiveLinkParams} from '@octokit/rest'
import {WriteStream} from 'fs'

const IS_WINDOWS = process.platform === 'win32'

export async function downloadRepository(
  accessToken: string,
  owner: string,
  repo: string,
  ref: string,
  commit: string,
  repositoryPath: string
): Promise<void> {
  // Determine archive path
  const runnerTemp = process.env['RUNNER_TEMP'] as string
  assert.ok(runnerTemp, 'RUNNER_TEMP not defined')
  const archivePath = path.join(runnerTemp, 'checkout.tar.gz')

  // Ensure file does not exist
  core.debug(`Ensuring archive file does not exist: ${archivePath}`)
  await io.rmRF(archivePath)

  // Download the archive
  let archiveData = await retryHelper.execute(async () => {
    core.info('Downloading the archive using the REST API')
    return await downloadArchive(accessToken, owner, repo, ref, commit)
  })

  // Write archive to disk
  core.info('Writing archive to disk')
  await fs.promises.writeFile(archivePath, archiveData)
  archiveData = Buffer.from('') // Free memory

  // // Get the archive URL using the REST API
  // await retryHelper.execute(async () => {
  //   // Prepare the archive stream
  //   core.debug(`Preparing the archive stream: ${archivePath}`)
  //   await io.rmRF(archivePath)
  //   const fileStream = fs.createWriteStream(archivePath)
  //   const fileStreamClosed = getFileClosedPromise(fileStream)

  //   try {
  //     // Get the archive URL
  //     core.info('Getting archive URL')
  //     const archiveUrl = await getArchiveUrl(
  //       accessToken,
  //       owner,
  //       repo,
  //       ref,
  //       commit
  //     )

  //     // Download the archive
  //     core.info('Downloading the archive') // Do not print the archive URL because it has an embedded token
  //     await downloadFile(archiveUrl, fileStream)
  //   } finally {
  //     fileStream.end()
  //     await fileStreamClosed
  //   }
  // })

  // Extract archive
  const extractPath = path.join(runnerTemp, `checkout`)
  await io.rmRF(extractPath)
  await io.mkdirP(extractPath)
  if (IS_WINDOWS) {
    await toolCache.extractZip(archivePath, extractPath)
  } else {
    await toolCache.extractTar(archivePath, extractPath)
  }

  // Determine the real directory to copy (ignore extra dir at root of the archive)
  const archiveFileNames = await fs.promises.readdir(extractPath)
  assert.ok(
    archiveFileNames.length == 1,
    'Expected exactly one directory inside archive'
  )
  const extraDirectoryName = archiveFileNames[0]
  core.info(`Resolved ${extraDirectoryName}`) // contains the short SHA
  const tempRepositoryPath = path.join(extractPath, extraDirectoryName)

  // Move the files
  for (const fileName of await fs.promises.readdir(tempRepositoryPath)) {
    const sourcePath = path.join(tempRepositoryPath, fileName)
    const targetPath = path.join(repositoryPath, fileName)
    await io.mv(sourcePath, targetPath)
  }

  await exec.exec(`find .`, [], {
    cwd: repositoryPath
  } as ExecOptions)
}

async function downloadArchive(
  accessToken: string,
  owner: string,
  repo: string,
  ref: string,
  commit: string
): Promise<Buffer> {
  const octokit = new github.GitHub(accessToken)
  const params: ReposGetArchiveLinkParams = {
    owner: owner,
    repo: repo,
    archive_format: IS_WINDOWS ? 'zipball' : 'tarball',
    ref: refHelper.getDownloadRef(ref, commit)
  }
  const response = await octokit.repos.getArchiveLink(params)
  console.log('GOT THE RESPONSE')
  console.log(`status=${response.status}`)
  console.log(`headers=${JSON.stringify(response.headers)}`)
  console.log(`data=${JSON.stringify(response.data)}`)
  if (response.status != 200) {
    throw new Error(
      `Unexpected response from GitHub API. Status: '${response.status}'`
    )
  }

  return Buffer.from(response.data) // response.data is ArrayBuffer
}

// async function getArchiveUrl(
//   accessToken: string,
//   owner: string,
//   repo: string,
//   ref: string,
//   commit: string
// ): Promise<string> {
//   const octokit = new github.GitHub(accessToken)
//   const params: RequestOptions & ReposGetArchiveLinkParams = {
//     method: 'HEAD',
//     owner: owner,
//     repo: repo,
//     archive_format: IS_WINDOWS ? 'zipball' : 'tarball',
//     ref: refHelper.getDownloadRef(ref, commit)
//   }
//   const response = await octokit.repos.getArchiveLink(params)
//   console.log('GOT THE RESPONSE')
//   console.log(`status=${response.status}`)
//   console.log(`headers=${JSON.stringify(response.headers)}`)
//   console.log(`data=${JSON.stringify(response.data)}`)
//   if (response.status != 200) {
//     throw new Error(
//       `Unexpected response from GitHub API. Status: '${response.status}'`
//     )
//   }
//   console.log('GETTING THE LOCATION')
//   const archiveUrl = response.headers['Location'] // Do not print the archive URL because it has an embedded token
//   assert.ok(
//     archiveUrl,
//     `Expected GitHub API response to contain 'Location' header`
//   )
//   return archiveUrl
// }

// function downloadFile(url: string, fileStream: WriteStream): Promise<void> {
//   return new Promise((resolve, reject) => {
//     try {
//       https.get(url, (response: IncomingMessage) => {
//         if (response.statusCode != 200) {
//           reject(`Request failed with status '${response.statusCode}'`)
//           response.resume() // Consume response data to free up memory
//           return
//         }

//         response.on('data', chunk => {
//           fileStream.write(chunk)
//         })
//         response.on('end', () => {
//           resolve()
//         })
//         response.on('error', err => {
//           reject(err)
//         })
//       })
//     } catch (err) {
//       reject(err)
//     }
//   })
// }

// function getFileClosedPromise(stream: WriteStream): Promise<void> {
//   return new Promise((resolve, reject) => {
//     stream.on('error', err => {
//       reject(err)
//     })
//     stream.on('finish', () => {
//       resolve()
//     })
//   })
// }
