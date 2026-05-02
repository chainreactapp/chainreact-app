import { ActionResult } from './core/executeWait'
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken'
import { resolveValue } from './core/resolveValue'

import { logger } from '@/lib/utils/logger'

/**
 * Create a new GitHub issue
 */
export async function createGitHubIssue(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      repository,
      title,
      body,
      labels = [],
      assignees = [],
      milestone
    } = resolvedConfig

    if (!repository || !title) {
      throw new Error("Repository and title are required")
    }

    // Get GitHub integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "github")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("GitHub integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "github")

    // Parse repository (format: owner/repo)
    const [owner, repo] = repository.split('/')
    if (!owner || !repo) {
      throw new Error("Repository must be in format 'owner/repo'")
    }

    // Create issue payload
    const payload: any = {
      title: title,
      body: body || ""
    }

    if (labels.length > 0) payload.labels = labels
    if (assignees.length > 0) payload.assignees = assignees
    if (milestone) payload.milestone = milestone

    // Create issue
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `token ${accessToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        issueId: result.id,
        issueNumber: result.number,
        title: result.title,
        body: result.body,
        state: result.state,
        url: result.html_url,
        repository: repository,
        labels: result.labels,
        assignees: result.assignees,
        githubResponse: result
      },
      message: `GitHub issue #${result.number} created successfully in ${repository}`
    }

  } catch (error: any) {
    logger.error("GitHub create issue error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create GitHub issue"
    }
  }
}

/**
 * Create a new GitHub repository
 */
export async function createGitHubRepository(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      name,
      description,
      private: isPrivate = true,
      autoInit = true,
      gitignoreTemplate,
      licenseTemplate,
      homepage
    } = resolvedConfig

    if (!name) {
      throw new Error("Repository name is required")
    }

    // Get GitHub integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "github")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("GitHub integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "github")

    // Create repository payload
    const payload: any = {
      name: name,
      description: description || "",
      private: isPrivate,
      auto_init: autoInit
    }

    if (gitignoreTemplate) payload.gitignore_template = gitignoreTemplate
    if (licenseTemplate) payload.license_template = licenseTemplate
    if (homepage) payload.homepage = homepage

    // Create repository
    const response = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `token ${accessToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        repositoryId: result.id,
        name: result.name,
        fullName: result.full_name,
        description: result.description,
        private: result.private,
        url: result.html_url,
        cloneUrl: result.clone_url,
        sshUrl: result.ssh_url,
        defaultBranch: result.default_branch,
        githubResponse: result
      },
      message: `GitHub repository ${result.full_name} created successfully`
    }

  } catch (error: any) {
    logger.error("GitHub create repository error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create GitHub repository"
    }
  }
}

/**
 * Create a new GitHub pull request
 *
 * Q12 / PR-G6 — when `base` is not supplied, the repo's `default_branch`
 * is fetched via `repos.get`. The prior silent `'main'` fallback is
 * removed: many repos use `master`, `develop`, `trunk`, etc. as their
 * default. If the auto-detect call fails, the handler returns
 * `success:false` rather than silently using `'main'` and producing a
 * PR against the wrong branch.
 */
export async function createGitHubPullRequest(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const {
      repository,
      title,
      body,
      head,
      base,
      draft = false
    } = resolvedConfig

    if (!repository || !title || !head) {
      throw new Error("Repository, title, and head branch are required")
    }

    // Get GitHub integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()

    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "github")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("GitHub integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "github")

    // Parse repository (format: owner/repo)
    const [owner, repo] = repository.split('/')
    if (!owner || !repo) {
      throw new Error("Repository must be in format 'owner/repo'")
    }

    // PR-G6 — auto-detect default branch when `base` is not supplied.
    // Hits `GET /repos/{owner}/{repo}` and reads `default_branch`. On
    // any failure, return `success:false` with category 'provider' rather
    // than silently falling back to 'main' (which guesses wrong on repos
    // that use master / develop / trunk).
    let effectiveBase: string
    if (typeof base === 'string' && base.length > 0) {
      effectiveBase = base
    } else {
      const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: "GET",
        headers: {
          Authorization: `token ${accessToken}`,
          "Accept": "application/vnd.github.v3+json",
        },
      })
      if (!repoResponse.ok) {
        const repoErr = await repoResponse.json().catch(() => ({}))
        return {
          success: false,
          category: 'provider',
          output: {},
          message: `Could not auto-detect default branch for ${repository}: ${repoResponse.status} - ${repoErr.message || repoResponse.statusText}. Set "base" explicitly in the workflow node.`,
        }
      }
      const repoData = await repoResponse.json()
      const detectedDefault = repoData.default_branch
      if (typeof detectedDefault !== 'string' || detectedDefault.length === 0) {
        return {
          success: false,
          category: 'provider',
          output: {},
          message: `GitHub returned no default_branch for ${repository}. Set "base" explicitly in the workflow node.`,
        }
      }
      effectiveBase = detectedDefault
    }

    // Create pull request payload
    const payload: any = {
      title: title,
      body: body || "",
      head: head,
      base: effectiveBase,
      draft: draft
    }

    // Create pull request
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `token ${accessToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        pullRequestId: result.id,
        pullRequestNumber: result.number,
        title: result.title,
        body: result.body,
        state: result.state,
        url: result.html_url,
        repository: repository,
        head: result.head.ref,
        base: result.base.ref,
        draft: result.draft,
        githubResponse: result
      },
      message: `GitHub pull request #${result.number} created successfully in ${repository}`
    }

  } catch (error: any) {
    logger.error("GitHub create pull request error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create GitHub pull request"
    }
  }
}

/**
 * Create a new GitHub Gist
 */
export async function createGitHubGist(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const {
      description,
      filename,
      content,
      isPublic = false
    } = resolvedConfig

    if (!filename || !content) {
      throw new Error("Filename and content are required")
    }

    // Get GitHub integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()

    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "github")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("GitHub integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "github")

    // Create gist payload
    const payload: any = {
      description: description || "",
      public: isPublic,
      files: {
        [filename]: {
          content: content
        }
      }
    }

    // Create gist
    const response = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        Authorization: `token ${accessToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        gistId: result.id,
        url: result.html_url,
        description: result.description,
        public: result.public,
        files: Object.keys(result.files),
        githubResponse: result
      },
      message: `GitHub Gist created successfully: ${result.html_url}`
    }

  } catch (error: any) {
    logger.error("GitHub create gist error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create GitHub gist"
    }
  }
}

/**
 * Create a new branch in a GitHub repository
 */
export async function createGitHubBranch(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const {
      repository,
      branchName,
      sourceBranch = "main"
    } = resolvedConfig

    if (!repository || !branchName) {
      throw new Error("Repository and branch name are required")
    }

    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()

    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "github")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("GitHub integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "github")

    // Parse repository (format: owner/repo)
    const [owner, repo] = repository.split('/')
    if (!owner || !repo) {
      throw new Error("Repository must be in format 'owner/repo'")
    }

    // Get the SHA of the source branch to branch from
    const sourceResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${sourceBranch}`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
          "Accept": "application/vnd.github.v3+json"
        }
      }
    )

    if (!sourceResponse.ok) {
      const errorData = await sourceResponse.json().catch(() => ({}))
      throw new Error(`Failed to get source branch "${sourceBranch}": ${sourceResponse.status} - ${errorData.message || sourceResponse.statusText}`)
    }

    const sourceRef = await sourceResponse.json()
    const sha = sourceRef.object.sha

    // Create the new branch ref
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${accessToken}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: sha
        })
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        ref: result.ref,
        branchName: branchName,
        sha: result.object.sha,
        repository: repository,
        sourceBranch: sourceBranch,
        url: `https://github.com/${owner}/${repo}/tree/${branchName}`,
        githubResponse: result
      },
      message: `Branch "${branchName}" created successfully in ${repository} from ${sourceBranch}`
    }

  } catch (error: any) {
    logger.error("GitHub create branch error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create GitHub branch"
    }
  }
}

/**
 * Add a comment to a GitHub issue or pull request
 */
export async function addGitHubComment(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    const {
      repository,
      issueNumber,
      body
    } = resolvedConfig

    if (!repository || !issueNumber || !body) {
      throw new Error("Repository, issue number, and comment body are required")
    }

    // Get GitHub integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()

    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "github")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("GitHub integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "github")

    // Parse repository (format: owner/repo)
    const [owner, repo] = repository.split('/')
    if (!owner || !repo) {
      throw new Error("Repository must be in format 'owner/repo'")
    }

    // Create comment payload
    const payload = {
      body: body
    }

    // Add comment
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      headers: {
        Authorization: `token ${accessToken}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        commentId: result.id,
        url: result.html_url,
        body: result.body,
        repository: repository,
        issueNumber: issueNumber,
        githubResponse: result
      },
      message: `Comment added successfully to ${repository} #${issueNumber}`
    }

  } catch (error: any) {
    logger.error("GitHub add comment error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to add GitHub comment"
    }
  }
}