import axios from 'axios';
import { Suite } from 'mocha';
import { getWorkspaces, createWorkspace } from '@support';

/**
 * Determines whether to skip the interceptor for a given URL.
 *
 * Rules:
 * 1. If the URL points to localhost or 127.* and port 8001:
 *    - Skip the interceptor only for paths related to workspace setup, license, CA certificates, or root ('/').
 *    - Otherwise, do not skip.
 * 2. For all other URLs, skip the interceptor by default.
 *
 * @param {URL} u - The URL object to check.
 * @returns {boolean} - true if the interceptor should be skipped, false otherwise.
 */
function shouldSkipInterceptor(u: URL) {
  if ((u.hostname === 'localhost' || u.hostname.startsWith('127.')) && u.port === '8001') {
    if (
      u.pathname.startsWith('/sdet-workspace') ||
      u.pathname.startsWith('/workspaces') ||
      u.pathname === '/' ||
      u.pathname === 'ca_certificates' ||
      u.pathname.startsWith('/license')
    ) {
      return true;
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Registers an Axios request interceptor that rewrites outgoing Admin API requests
 * to target the specified workspace. If the request URL does not already contain a workspace
 * segment, it prepends the given workspaceName to the path. Certain paths (e.g. workspace setup, license, CA certificates)
 * are excluded from rewriting for safety.
 *
 * @param workspaceName - The workspace name to inject into request URLs.
 * @param allWorkspaces - List of all workspace names for validation.
 * @returns The interceptor ID, which should be used to eject the interceptor after tests.
 */
function attachWorkspaceInterceptor(workspaceName: string, allWorkspaces: string[]): number {
  const interceptorId = axios.interceptors.request.use(config => {
    if (!config.url) return config;
    config.headers = config.headers || {};

    const url = config.url.trim();
    const u = new URL(url);

    // skip certain paths that should not be modified
    if (shouldSkipInterceptor(u)) return config;

    // skip url modification if workspace is already present in the url and it is not 'default'
    const firstSegment = u.pathname.match(/^\/([^/]+)/)?.[1];
    if (firstSegment && firstSegment !== 'default' && allWorkspaces.includes(firstSegment)) {
      return config;
    }

    // prepend workspace to requests and update URLs missing it
    if (u.pathname.startsWith('/default')) {
      u.pathname = u.pathname.replace(/^\/default/, '') || '/';
    }

    const originalUrl = config.url;
    config.url = `${u.origin}/${workspaceName}${u.pathname}`;
    console.log(`[Interceptor] ${originalUrl} → ${config.url}`);

    return config;
  });

  return interceptorId;
}

/**
 * Removes the Axios request interceptor for workspace URL rewriting.
 * Should be called after the test suite to avoid interceptor accumulation and side effects.
 *
 * @param interceptorId - The ID returned by attachWorkspaceInterceptor.
 */
function detachWorkspaceInterceptor(interceptorId: number) {
  axios.interceptors.request.eject(interceptorId);
  console.log(`[Workspace Interceptor] Ejected (id=${interceptorId})`);
}

/**
 * Registers a test suite for both default and non-default workspaces.
 * The callback fn is called in the describe scope, allowing direct registration of multiple
 * hooks and tests (it/before/after) for each workspace context.
 *
 * Usage pattern:
 * - Use fn to register all hooks/tests that should run in both workspace contexts.
 * - The Mocha context (this) is set to the current workspace name for each suite.
 * - Axios interceptor is attached for non-default workspace to rewrite Admin API requests.
 * - Interceptor is automatically removed after the suite.
 *
 * @param title - The test suite title.
 * @param fn - Callback to register hooks/tests; receives Mocha Suite context.
 * @param options - Optional flags to skip default or non-default workspace suites.
 */
export function describeWithWorkspaces(
  title: string,
  fn: (this: Suite) => void,
  options?: { skipDefaultWorkspace?: boolean; skipNonDefaultWorkspace?: boolean },
) {
  if (!options?.skipDefaultWorkspace) {
    describe(`${title} (default workspace)`, function () {
      before(function () {
        (this as any).workspace = 'default';
      });

      fn.call(this);
    });
  }

  if (!options?.skipNonDefaultWorkspace) {
    // Auto-skip if no non-default workspace is available
    const workspaceName = globalThis.nonDefaultWorkspace;

    if (!workspaceName) {
      describe(`${title} (non-default workspace)`, function () {
        it.skip('Non-default workspace not available for this test environment');
      });
      return;
    }
    // Only proceed if workspace is available
    describe(`${title} (non-default workspace)`, function () {
      let interceptorId: number;

      before(async function () {
        const workspaceName = globalThis.nonDefaultWorkspace;
        const { data: workspacesData = [] } = await getWorkspaces();

        // Ensure the non-default workspace exists
        let workspace = workspacesData.find(w => w.name === workspaceName);
        if (!workspace) {
          console.log(`Workspace "${workspaceName}" not found, creating one...`);
          workspace = await createWorkspace(workspaceName);
          workspacesData.push(workspace);
        }

        // Collect all workspace names
        const allWorkspaceNames = workspacesData.map(ws => ws.name);

        // Attach interceptor
        interceptorId = attachWorkspaceInterceptor(workspaceName, allWorkspaceNames);
        console.log(`[Workspace Interceptor] Attached for workspace: ${workspaceName}`);

        this.workspace = workspaceName;
      });

      fn.call(this);

      after(async function () {
        await new Promise(resolve => setImmediate(resolve));

        if (interceptorId !== undefined) {
          detachWorkspaceInterceptor(interceptorId);
        }
      });
    });
  }
}
