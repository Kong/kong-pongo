import { execSync } from 'child_process';
import { isLoggingEnabled } from '../utilities/logging';

/**
 * kubectl wait command for the pod to meet certain condition
 * @param {string} namespace - kong namespace
 * @param {string} appName - app name 
 * @param {string} condition - condition to wait for
 * @param {string} timeout - timeout in seconds, default is 30s
 * @returns {boolean} true/false
 */
export const kubectlWaitPod = (namespace='kong', appName, condition='Ready', timeout='30s') => {
  try {
    execSync(`kubectl wait pod -n ${namespace} -l app=${appName} --for=condition=${condition} --timeout=${timeout}`, { stdio: 'inherit' });
    return true;
  } catch (error: any) {
    console.log(`Something went wrong with waiting for pod to meet condition: ${error}`);
    return false;
  }
};

/**
 * kubectl port-forward command for the pod
 * @param {string} namespace - kong namespace
 * @param {string} appName - app name 
 * @param {string} portMapping - port mapping, eg. 8000:8000 8443:8443
 */
export const kubectlPortForward = (namespace='kong', appName, portMapping) => {
  try {
    //kill the zombie process related to previous kubectl port-forward
    execSync(`pkill -f "[k]ubectl port-forward ${appName}" || true`);
    
    execSync(`kubectl get pods -n ${namespace}`);
    if (isLoggingEnabled()) {
      return execSync(`nohup kubectl port-forward $(kubectl get pods -n ${namespace} -l app=${appName} -o=jsonpath='{.items[0].metadata.name}' --field-selector=status.phase=Running) ${portMapping} -n ${namespace} > ${appName}-port-forward.log 2>&1 &`, { stdio: 'inherit' });
    } else {
      return execSync(`nohup kubectl port-forward $(kubectl get pods -n ${namespace} -l app=${appName} -o=jsonpath='{.items[0].metadata.name}' --field-selector=status.phase=Running) ${portMapping} -n ${namespace} > /dev/null 2>&1 &`, { stdio: 'inherit' });
    }
  } catch (error) {
    console.log('Something went wrong with kubectl port-forward command', error);
  }
};

/**
 * execute terraform command
 * @param {string} command 
 * @param {string} folder - terraform folder name, default is 'deploy-k8s'
 */
export const executeTerraformCommand = (command, folder='deploy-k8s') => {
  try {
    return execSync(
      `folder="${folder}" command="${command}" make execute_terraform_command`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.log(
      `Something went wrong while executing the terraform command: ${error}`
    );
  }
}

/*
* check the health of pods
* @param {string} namespace - kong namespace
* @param {string[]} labelSelectors - label selectors
* @returns {boolean} true/false
*/
export const checkPodsHealth = (namespace: string, labelSelectors: string[]): boolean => {
  for (const labelSelector of labelSelectors) {
    console.log(`Checking pods with label: ${labelSelector}`);

    try {
      const output = execSync(
        `kubectl get pods -n ${namespace} -l app=${labelSelector} --no-headers`,
        { encoding: "utf-8" }
      );

      console.log(output); // Log the output for debugging

      const lines = output.trim().split("\n");

      for (const line of lines) {
        const columns = line.split(/\s+/);
        const name = columns[0];
        const ready = columns[1]; // e.g. 1/1
        const status = columns[2]; // e.g. Running, CrashLoopBackOff

        console.log(`➡️ Pod: ${name}, Status: ${status}, Ready: ${ready}`);

        // Pod must be Running or Completed
        if (status !== "Running" && status !== "Completed") {
          console.warn(`Pod ${name} is in bad status: ${status}`);
          return false;
        }

        // Ready containers should be equal (e.g., 1/1, 2/2)
        if (!/^(\d+)\/\1$/.test(ready)) {
          console.warn(`Pod ${name} not fully ready: ${ready}`);
          return false;
        }
      }
    } catch (err: any) {
      console.error(`Failed to get pods for label "${labelSelector}": ${err.message}`);
      return false;
    }
  }

  console.log("All pods across all selectors are healthy.");
  return true;
}