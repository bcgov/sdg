# Security Policy

## Supported Versions

This product currently has no support and is experimental. That could change in the future.

## Reporting a Vulnerability

**DO NOT open public GitHub issues for security vulnerabilities.**

If you believe you have found a security vulnerability in this project, please report it privately:

1. Navigate to the main page of this repository on GitHub.
2. Click the **"Security"** tab at the top of the repository (next to "Insights").
3. In the left sidebar under "Reporting", click **"Advisories"**.
4. Click the **"Report a vulnerability"** button to privately submit a report to the repository maintainers.

## OWASP ASVS Alignment

Out of the box, this QuickStart repository is hardened to satisfy Level 1 and Level 2 requirements of the **OWASP Application Security Verification Standard (ASVS) v4.0.3**. The table below outlines how this template implements and verifies specific security controls.

| ASVS v4.0.3 Section | Category / Control              | QuickStart Implementation                                                                                                                                            | Verification / Automation                                                                                                                                                                                                                      |
| :------------------ | :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V5.5**            | Active Application Defense      | Runs the **Coraza Web Application Firewall (WAF)** inline in the Caddy edge, with custom rules in `apps/portal-web/caddy/coraza.conf` (the OWASP CRS is not loaded). | `scripts/compose-smoke.sh` and `scripts/images-smoke.sh` assert that blocked requests (e.g. `/.env`, scanner User-Agents) get `403`.                                                                                                           |
| **V14.2**           | Build-Time Security Scans       | Scans for container base image vulnerabilities and code weaknesses during development.                                                                               | Automated [Trivy](https://github.com/aquasecurity/trivy) scans (vulnerabilities, secrets, misconfigurations) in the Analysis workflow on every PR; [CodeQL](https://codeql.github.com/) runs as GitHub default setup.                          |
| **V14.2**           | Dependency Security             | Automatically patches outdated packages and scans for unused dependencies/exports.                                                                                   | [Mend Renovate](https://github.com/bcgov/renovate-config) for automated pull requests and [Knip](https://knip.dev/) scans running in the Analysis workflow.                                                                                    |
| **V14.2**           | Secret Management               | Separates database connection credentials, API keys, and environment-specific configs from code.                                                                     | portal-api secrets come from Vault or Kubernetes Secrets; `charts/portal-api/tests/configmap_test.yaml` asserts the ConfigMap holds no secret keys. Trivy secret scanning and GitHub push protection catch committed secrets.                  |
| **V14.2**           | Dynamic Security Testing (DAST) | Performs automated runtime penetration tests on the deployed application.                                                                                            | Scheduled **OWASP ZAP** full scans running weekly in the Scheduled workflow against the deployed `test` environment.                                                                                                                           |
| **V14.4**           | HTTP Secure Headers             | Strips identifying `Server` headers and enforces secure HTTP response headers (CSP, HSTS, X-Frame-Options, same-origin, and MIME sniffing blocks).                   | Set in `apps/portal-web/caddy/common.caddy`; `scripts/compose-smoke.sh` asserts the headers and CSP.                                                                                                                                           |
| **V14.4**           | Container Hardening             | Restricts container execution permissions and prevents host system modifications.                                                                                    | Charts run non-root with all capabilities dropped, no privilege escalation, `RuntimeDefault` seccomp and read-only root filesystems (helm-unittest in `pnpm test:charts`); `scripts/images-smoke.sh` starts every image with `--cap-drop ALL`. |
| **V14.4**           | Network Segmentation            | Controls pod communication, isolating network traffic between the edge, portal-web, portal-api, and database/cache tiers.                                            | Per-chart `NetworkPolicy` resources, covered by helm-unittest in `pnpm test:charts`.                                                                                                                                                           |

## Vulnerability Triage SLAs

All security issues are triaged using CISA KEV status and CVSS scores:

- **Critical** (CVSS 9.0-10.0 or CISA KEV): Remediation within 24 hours.
- **High** (CVSS 7.0-8.9): Remediation within 1 week.
- **Medium** (CVSS 4.0-6.9): Remediation within 2 weeks.
- **Low** (CVSS 0.0-3.9): Remediation next scheduled release.

Trivy reports findings at every severity to the GitHub Security tab on each run, where they are triaged against the windows above. Findings are not a merge gate, because advisories are published independently of any contribution. Committed secrets are blocked at push time by GitHub secret scanning push protection instead.
