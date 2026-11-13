#!/usr/bin/env python3
"""Turns new errors in Azure logs into GitHub issues labelled `bug`.

Runs from .github/workflows/error-triage.yml (already logged in to Azure and GitHub).
- Looks `--lookback` minutes back in the Log Analytics workspace (App Insights is workspace-based, so one place).
- Every distinct error gets a fingerprint; its issue title ends in `[fp:xxxxxxxxxx]`.
- Same error already has an open issue -> nothing. Issue was closed and the error happened again afterwards -> reopened.
- Anything that could hold personal data or secrets is redacted before it is written to GitHub.
"""
import argparse, datetime as dt, hashlib, json, os, re, subprocess, sys

# kind, human label, KQL ({lb} = lookback minutes), columns that identify the error, column with a sample to show
QUERIES = [
    ("api-exception", "API exception",
     """AppExceptions | where TimeGenerated > ago({lb}m) and AppRoleName == 'correlaite-api'
        | summarize n=count(), last=max(TimeGenerated), sample=any(tostring(Details)) by ExceptionType, OuterMessage, OperationName""",
     ["ExceptionType", "OuterMessage", "OperationName"], "sample"),
    ("api-5xx", "API request failed (5xx)",
     """AppRequests | where TimeGenerated > ago({lb}m) and AppRoleName == 'correlaite-api' and toint(ResultCode) >= 500
        | summarize n=count(), last=max(TimeGenerated), sample=any(Url) by Name, ResultCode""",
     ["Name", "ResultCode"], "sample"),
    ("api-log", "API error log",
     """ContainerAppConsoleLogs_CL | where TimeGenerated > ago({lb}m) and Log_s startswith '{{'
        | extend j = parse_json(Log_s) | where toint(j.level) >= 50
        | extend msg = tostring(j.msg), err = tostring(j.err.message)
        | summarize n=count(), last=max(TimeGenerated), sample=any(Log_s) by msg, err""",
     ["msg", "err"], "sample"),
    ("web-exception", "Browser exception",
     """AppExceptions | where TimeGenerated > ago({lb}m) and AppRoleName == 'correlaite-web'
        | summarize n=count(), last=max(TimeGenerated), sample=any(tostring(Details)) by ExceptionType, OuterMessage""",
     ["ExceptionType", "OuterMessage"], "sample"),
    ("email-delivery", "Email not delivered",
     """ACSEmailStatusUpdateOperational | where TimeGenerated > ago({lb}m) and DeliveryStatus !in~ ('Delivered', 'Expanded')
        | summarize n=count(), last=max(TimeGenerated), sample=any(tostring(pack_all())) by DeliveryStatus""",
     ["DeliveryStatus"], "sample"),
]

MISSING_TABLE = re.compile(r"Failed to resolve|could not be resolved|SEM0100|BadArgumentError.*table", re.I)


def redact(text: str) -> str:
    text = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "<email>", text)
    text = re.sub(r"(?i)\b(key|secret|password|pwd|token|sig|accountkey|sharedaccesskey)(\"?\s*[=:]\s*\"?)[^;&\s\"',}]+", r"\1\2<redacted>", text)
    text = re.sub(r"[A-Za-z0-9_\-+/=]{32,}", "<redacted>", text)
    return text


def normalise(text: str) -> str:
    t = redact(text).lower()
    t = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<id>", t)
    t = re.sub(r"\b[0-9a-f]{8,}\b", "<hex>", t)
    t = re.sub(r"\d+", "<n>", t)
    return re.sub(r"\s+", " ", t).strip()


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def kql(workspace: str, query: str) -> list[dict]:
    p = run(["az", "monitor", "log-analytics", "query", "-w", workspace, "--analytics-query", " ".join(query.split()), "-o", "json"])
    if p.returncode != 0:
        if MISSING_TABLE.search(p.stderr):
            return []  # table does not exist yet (nothing was ever logged there): not an error
        raise RuntimeError(p.stderr.strip()[-600:])
    return json.loads(p.stdout or "[]")


def parse_time(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else dt.datetime.now(dt.timezone.utc)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True)
    ap.add_argument("--resource-group", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--lookback", type=int, default=60)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-new", type=int, default=10)
    a = ap.parse_args()

    ws = run(["az", "monitor", "log-analytics", "workspace", "show", "-g", a.resource_group, "-n", f"correlaite-{a.env}-law", "--query", "customerId", "-o", "tsv"])
    if ws.returncode != 0:
        print("Cannot find the Log Analytics workspace:", ws.stderr.strip(), file=sys.stderr)
        return 1
    workspace = ws.stdout.strip()

    findings = []  # (kind, label, key text, count, last, sample, query)
    for kind, label, query, keys, sample_col in QUERIES:
        q = query.format(lb=a.lookback)
        try:
            rows = kql(workspace, q)
        except RuntimeError as e:
            # A broken monitoring query must not fail silently: it becomes an issue of its own.
            findings.append(("monitor", "Error monitor query failed", kind, 1, dt.datetime.now(dt.timezone.utc).isoformat(), str(e), q))
            continue
        for r in rows:
            key = " | ".join(str(r.get(k) or "") for k in keys)
            findings.append((kind, label, key, int(r.get("n") or 1), r.get("last"), str(r.get(sample_col) or ""), q))

    print(f"[{a.env}] {len(findings)} distinct error(s) in the last {a.lookback} minutes")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    created = 0
    lines = []
    for kind, label, key, n, last, sample, q in findings:
        fp = hashlib.sha1(f"{a.env}|{kind}|{normalise(key)}".encode()).hexdigest()[:10]
        short = redact(key).replace("\n", " ")
        short = (short[:90] + "…") if len(short) > 90 else short
        title = f"[{a.env}] {label}: {short} [fp:{fp}]"
        status = "dry-run"
        if not a.dry_run:
            found = run(["gh", "issue", "list", "--repo", a.repo, "--search", f"{fp} in:title", "--state", "all", "--json", "number,state,closedAt,title", "--limit", "10"])
            existing = [i for i in json.loads(found.stdout or "[]") if f"fp:{fp}" in i["title"]] if found.returncode == 0 else []
            body = (
                f"**Environment:** {a.env}  \n**Source:** {label} (`{kind}`)  \n**Seen:** {n}× in the last {a.lookback} min, most recently {last}\n\n"
                f"**Details**\n```\n{redact(key)}\n```\n"
                + (f"**Sample**\n```\n{redact(sample)[:1500]}\n```\n" if sample else "")
                + f"\n<details><summary>Log query</summary>\n\n```kusto\n{' '.join(q.split())}\n```\n</details>\n\n"
                  f"_Created automatically by the Error triage workflow. Close the issue when it is fixed; it is reopened if the error happens again afterwards._\n\n<!-- fp:{fp} -->"
            )
            if not existing:
                if created >= a.max_new:
                    status = "skipped (new-issue limit reached this run)"
                else:
                    labels = ["--label", "bug", "--label", "auto-detected", "--label", f"env:{a.env}"]
                    p = run(["gh", "issue", "create", "--repo", a.repo, "--title", title, "--body", body, *labels])
                    status = f"created {p.stdout.strip()}" if p.returncode == 0 else f"create failed: {p.stderr.strip()}"
                    created += p.returncode == 0
            else:
                i = existing[0]
                if i["state"] == "CLOSED" and i.get("closedAt") and parse_time(last) > parse_time(i["closedAt"]):
                    run(["gh", "issue", "reopen", str(i["number"]), "--repo", a.repo, "--comment", f"This error happened again ({n}× in the last {a.lookback} min, most recently {last}) after the issue was closed."])
                    status = f"reopened #{i['number']}"
                else:
                    status = f"known (#{i['number']}, {i['state'].lower()})"
        lines.append(f"- {title} — {status}")
        print(f"  {title} — {status}")
        if kind == "monitor":
            print("    reason:", redact(sample).replace("\n", " ")[:500])
    if summary:
        with open(summary, "a") as f:
            f.write(f"### {a.env}: {len(findings)} distinct error(s)\n" + ("\n".join(lines) or "No errors found.") + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
