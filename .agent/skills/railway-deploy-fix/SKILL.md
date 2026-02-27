---
name: railway-deploy-fix
description: Steps to troubleshoot and fix common Railway deployment issues, including "Payload Too Large" (413) caused by ignoring rules and "ERR_MODULE_NOT_FOUND" caused by missing production dependencies.
---

# Railway Deployment Fix Patterns

## 1. Fix "Payload Too Large" (413 Error) on `railway up`

If `railway up` fails with `413 Payload Too Large` or uploads > 50MB of data, it means local artifacts (node_modules, uploads, .git) are being sent to the build server.

### The Cause
Railway uses `.railwayignore` to exclude files. If this file is missing, corrupt (UTF-16 encoding from PowerShell), or incomplete, everything gets uploaded.

### The Fix
Create/Overwrite `.railwayignore` with **UTF-8 encoding** (avoid PowerShell redirection `>`) and include these heavy directories:

```gitignore
node_modules
dist
.git
.gitignore
.env
.idea
.vscode
.DS_Store
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
uploads
backend/node_modules
.agent
.agents
```

**Command to generate safely in PowerShell:**
(Do not use `echo "..." > .railwayignore` as it creates UTF-16 LE)
Use `Set-Content` or your editor to create the file.

---

## 2. Fix "ERR_MODULE_NOT_FOUND" (Missing Dependencies)

If the app crashes on Railway with `Cannot find package 'X'`, but works locally:

### The Cause
The package is listed in `devDependencies` instead of `dependencies`, or not listed at all in `package.json`. Railway prunes `devDependencies` in production (NODE_ENV=production).

### The Fix
1. **Identify the missing package** from Railway logs.
2. **Install it as a production dependency**:
   ```bash
   npm install <package-name>
   # wrapper for: npm install <package-name> --save-prod
   ```
3. **Commit the change** (crucial, as Railway builds from the commit context or uploaded code):
   ```bash
   git add package.json package-lock.json
   git commit -m "fix(deps): move <package-name> to dependencies"
   ```
4. **Redeploy**:
   ```bash
   railway up
   ```

## 3. Deployment Checklist

Before running `railway up` after a long break:

1. **Check size**: Ensure `uploads/` and `node_modules/` are ignored.
2. **Check deps**: Ensure all *runtime* libraries (nodemailer, mustache, pg, etc.) are in `dependencies`, not `devDependencies`.
3. **Check build**: Run `npm run build` locally to catch compilation errors early.
