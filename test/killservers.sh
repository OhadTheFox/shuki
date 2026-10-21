#!/bin/bash
# Stops local test servers left running (wrangler dev / workerd), e.g. after an interrupted run.
ps -eo pid,args | grep -E "[w]orkerd|[w]rangler-dist/cli.js dev|[e]sbuild --service" | awk "{print \$1}" | xargs -r kill -9 2>/dev/null
