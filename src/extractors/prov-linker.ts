import type { ExtractorContext } from "./git-extractor.js";

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function extractIssueRefs(text: string): number[] {
  const nums = new Set<number>();
  for (const m of text.matchAll(/(?:issue#|fixes\s+#|closes\s+#|refs\s+#|#)(\d+)/gi)) {
    nums.add(Number(m[1]));
  }
  return [...nums];
}

function extractReqCodes(text: string): string[] {
  const codes = new Set<string>();
  for (const m of text.matchAll(/\b(REQ-\d+)\b/g)) {
    codes.add(m[1]);
  }
  return [...codes];
}

export async function runProvLinker(ctx: ExtractorContext) {
  const { store, stepDelayMs = 0, onStep } = ctx;

  const entities = new Map(store.getEntities().map((e) => [e.id, e]));
  const commitActivities = store
    .getActivities()
    .filter((a) => a.activityType === "CommitActivity");
  const agents = store.getAgents();

  let items = 0;
  let relCount = 0;

  // Step 1: Link Git author agents <-> GitHub user agents sharing an email
  const githubByEmail = new Map<string, string>();
  for (const ag of agents) {
    if (ag.id.startsWith("agent:github:") && typeof ag.attributes.email === "string") {
      githubByEmail.set(ag.attributes.email.toLowerCase(), ag.id);
    }
  }
  for (const ag of agents) {
    if (ag.id.startsWith("agent:git:") && typeof ag.attributes.email === "string") {
      const ghId = githubByEmail.get(ag.attributes.email.toLowerCase());
      if (ghId) {
        store.addRelation({
          relationType: "actedOnBehalfOf",
          subjectId: ag.id,
          objectId: ghId,
          role: "provtrace:samePersonIdentity",
          attributes: {},
        });
        relCount++;
      }
    }
  }
  items++;
  await onStep?.({
    progressPct: 25,
    itemsProcessed: items,
    relationsCreated: relCount,
    message: `Unified ${relCount} Git/GitHub developer agent identities`,
  });
  await sleep(stepDelayMs);

  // Step 2: Link AsciiDoc Requirements <-> GitHub Issues
  const requirements = store.getEntities("Requirement");
  for (const req of requirements) {
    const refs = (req.attributes.sourceRefs as string[] | undefined) ?? [];
    for (const issueNum of refs) {
      const issueId = `entity:issue:${issueNum}`;
      if (entities.has(issueId)) {
        store.addRelation({
          relationType: "wasDerivedFrom",
          subjectId: req.id,
          objectId: issueId,
          role: "provtrace:specifiedFromIssue",
          attributes: {},
        });
        relCount++;
      }
    }
    items++;
  }

  // Check Issue bodies referencing other issues or REQ-* codes
  const issues = [...store.getEntities("Issue"), ...store.getEntities("Bug")];
  for (const issue of issues) {
    const body = String(issue.attributes.body ?? "");
    const issueNum = Number(issue.attributes.number);
    for (const refNum of extractIssueRefs(body)) {
      if (refNum !== issueNum && entities.has(`entity:issue:${refNum}`)) {
        store.addRelation({
          relationType: "wasDerivedFrom",
          subjectId: issue.id,
          objectId: `entity:issue:${refNum}`,
          role: "provtrace:issueFollowUp",
          attributes: {},
        });
        relCount++;
      }
    }
    for (const reqCode of extractReqCodes(body)) {
      const reqId = `entity:req:${reqCode}`;
      if (entities.has(reqId)) {
        const reqAlreadyDerivedFromIssue =
          (entities.get(reqId)?.attributes.sourceRefs as string[] | undefined)?.includes(
            String(issueNum)
          ) ?? false;
        if (!reqAlreadyDerivedFromIssue) {
          store.addRelation({
            relationType: "wasDerivedFrom",
            subjectId: issue.id,
            objectId: reqId,
            role: "provtrace:tracksRequirement",
            attributes: {},
          });
          relCount++;
        }
      }
    }
    items++;
  }

  await onStep?.({
    progressPct: 55,
    itemsProcessed: items,
    relationsCreated: relCount,
    message: `Connected AsciiDoc requirements and GitHub issues`,
  });
  await sleep(stepDelayMs);

  // Step 3: Link CommitActivity -> Issues and Requirements
  for (const commitAct of commitActivities) {
    const fullMsg = String(commitAct.attributes.fullMessage ?? commitAct.label);
    const categories = (commitAct.attributes.categories as string[] | undefined) ?? [];
    const touchesCodeOrTests = categories.includes("code") || categories.includes("tests");

    const issueNums = extractIssueRefs(fullMsg);
    const reqCodes = extractReqCodes(fullMsg);

    for (const num of issueNums) {
      const issueId = `entity:issue:${num}`;
      if (!entities.has(issueId)) continue;

      store.addRelation({
        relationType: "used",
        subjectId: commitAct.id,
        objectId: issueId,
        attributes: {},
      });
      store.addRelation({
        relationType: "wasInformedBy",
        subjectId: commitAct.id,
        objectId: `activity:issue-report:${num}`,
        attributes: {},
      });
      relCount += 2;
    }

    for (const code of reqCodes) {
      const reqId = `entity:req:${code}`;
      if (!entities.has(reqId)) continue;

      // Code/test commits consume the Requirement they implement via prov:used
      // (Docs commits that authored the Requirement are already linked via wasGeneratedBy)
      if (touchesCodeOrTests) {
        store.addRelation({
          relationType: "used",
          subjectId: commitAct.id,
          objectId: reqId,
          attributes: {},
        });
        relCount++;
      }
    }
    items++;
  }

  await onStep?.({
    progressPct: 80,
    itemsProcessed: items,
    relationsCreated: relCount,
    message: `Linked categorized commit activities to requirements & issues`,
  });
  await sleep(stepDelayMs);

  // Step 4: Link Pull Requests -> Constituent Commits (hadMember) & Issues
  const pullRequests = store.getEntities("PullRequest");
  for (const pr of pullRequests) {
    const closesIssues = (pr.attributes.closes_issues as number[] | undefined) ?? [];
    const subjectMatch = String(pr.attributes.commit_subject_match ?? "");
    const prNum = Number(pr.attributes.number);
    const reviewActId = `activity:pr-review:${prNum}`;

    for (const issueNum of closesIssues) {
      const issueId = `entity:issue:${issueNum}`;
      if (entities.has(issueId)) {
        store.addRelation({
          relationType: "wasDerivedFrom",
          subjectId: pr.id,
          objectId: issueId,
          role: "provtrace:resolvesIssue",
          attributes: {},
        });
        store.addRelation({
          relationType: "used",
          subjectId: reviewActId,
          objectId: issueId,
          attributes: {},
        });
        relCount += 2;
      }
    }

    if (subjectMatch) {
      const matchingCommits = commitActivities.filter((c) =>
        String(c.attributes.subject ?? "").includes(subjectMatch)
      );
      for (const matchingCommitAct of matchingCommits) {
        store.addRelation({
          relationType: "hadMember",
          subjectId: pr.id,
          objectId: matchingCommitAct.id,
          role: "prov:Collection",
          attributes: {},
        });
        store.addRelation({
          relationType: "wasInformedBy",
          subjectId: reviewActId,
          objectId: matchingCommitAct.id,
          attributes: {},
        });
        relCount += 2;
      }
    }
    items++;
  }

  await onStep?.({
    progressPct: 100,
    itemsProcessed: items,
    relationsCreated: relCount,
    message: `Completed cross-source W3C PROV derivation graph (${relCount} links created)`,
  });
  await sleep(stepDelayMs);

  return { itemsProcessed: items, relationsCreated: relCount };
}
