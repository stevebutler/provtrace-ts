import { readFileSync } from "node:fs";
import type { ExtractorContext } from "./git-extractor.js";

interface GitHubFixture {
  repository: { full_name: string };
  users: Array<{
    login: string;
    name: string;
    email: string;
    role: string;
  }>;
  issues: Array<{
    number: number;
    title: string;
    state: "open" | "closed";
    kind: string;
    labels: string[];
    user: string;
    created_at: string;
    closed_at: string | null;
    closed_by: string | null;
    body: string;
  }>;
  pull_requests: Array<{
    number: number;
    title: string;
    state: "open" | "merged" | "closed";
    user: string;
    reviewer: string | null;
    created_at: string;
    merged_at: string | null;
    closes_issues: number[];
    commit_subject_match: string;
  }>;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export async function runGitHubExtractor(ctx: ExtractorContext) {
  const { store, fixtureFile, stepDelayMs = 0, onStep } = ctx;
  const data = JSON.parse(readFileSync(fixtureFile, "utf8")) as GitHubFixture;

  let items = 0;
  let relations = 0;
  const totalSteps = data.users.length + data.issues.length + data.pull_requests.length;
  let step = 0;

  for (const user of data.users) {
    const agentId = `agent:github:${user.login}`;
    store.upsertAgent({
      id: agentId,
      agentType: "Person",
      label: `@${user.login} (${user.name})`,
      attributes: {
        login: user.login,
        name: user.name,
        email: user.email.toLowerCase(),
        role: user.role,
      },
    });
    items++;
    step++;
  }

  for (const issue of data.issues) {
    const isBug = issue.kind === "bug" || issue.labels.includes("bug");
    const entityId = `entity:issue:${issue.number}`;
    const creatorAgentId = `agent:github:${issue.user}`;
    const reportActivityId = `activity:issue-report:${issue.number}`;

    store.upsertActivity({
      id: reportActivityId,
      activityType: "IssueReport",
      label: `Open Issue #${issue.number}: ${issue.title}`,
      source: "github-issues",
      startedAt: issue.created_at,
      endedAt: issue.created_at,
      attributes: {
        issueNumber: issue.number,
        state: issue.state,
      },
    });

    store.upsertEntity({
      id: entityId,
      entityType: isBug ? "Bug" : "Issue",
      label: `#${issue.number} ${issue.title}`,
      source: "github-issues",
      createdAt: issue.created_at,
      attributes: {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        body: issue.body,
        closed_at: issue.closed_at,
        closed_by: issue.closed_by,
      },
    });
    items++;

    store.addRelation({
      relationType: "wasGeneratedBy",
      subjectId: entityId,
      objectId: reportActivityId,
      attributes: {},
    });
    store.addRelation({
      relationType: "wasAttributedTo",
      subjectId: entityId,
      objectId: creatorAgentId,
      attributes: {},
    });
    store.addRelation({
      relationType: "wasAssociatedWith",
      subjectId: reportActivityId,
      objectId: creatorAgentId,
      role: "reporter",
      attributes: {},
    });
    relations += 3;

    if (issue.state === "closed" && issue.closed_at) {
      const closeActivityId = `activity:issue-close:${issue.number}`;
      store.upsertActivity({
        id: closeActivityId,
        activityType: "IssueResolution",
        label: `Resolve Issue #${issue.number}`,
        source: "github-issues",
        startedAt: issue.created_at,
        endedAt: issue.closed_at,
        attributes: {
          issueNumber: issue.number,
        },
      });
      store.addRelation({
        relationType: "used",
        subjectId: closeActivityId,
        objectId: entityId,
        attributes: {},
      });
      relations++;

      if (issue.closed_by) {
        store.addRelation({
          relationType: "wasAssociatedWith",
          subjectId: closeActivityId,
          objectId: `agent:github:${issue.closed_by}`,
          role: "resolver",
          attributes: {},
        });
        relations++;
      }
    }

    step++;
    await onStep?.({
      progressPct: Math.round((step / Math.max(totalSteps, 1)) * 100),
      itemsProcessed: items,
      relationsCreated: relations,
      message: `Loaded GitHub ${isBug ? "Bug" : "Issue"} #${issue.number} (${issue.state})`,
    });
    await sleep(stepDelayMs);
  }

  for (const pr of data.pull_requests) {
    const prEntityId = `entity:pr:${pr.number}`;
    const prAuthorId = `agent:github:${pr.user}`;
    const reviewActivityId = `activity:pr-review:${pr.number}`;

    store.upsertEntity({
      id: prEntityId,
      entityType: "PullRequest",
      label: `PR #${pr.number}: ${pr.title}`,
      source: "github-issues",
      createdAt: pr.created_at,
      attributes: {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        merged_at: pr.merged_at,
        closes_issues: pr.closes_issues,
        commit_subject_match: pr.commit_subject_match,
      },
    });
    items++;

    store.upsertActivity({
      id: reviewActivityId,
      activityType: "PullRequestReview",
      label: `PR #${pr.number} Review (${pr.state})`,
      source: "github-issues",
      startedAt: pr.created_at,
      endedAt: pr.merged_at ?? pr.created_at,
      attributes: {
        prNumber: pr.number,
        state: pr.state,
      },
    });

    store.addRelation({
      relationType: "wasAttributedTo",
      subjectId: prEntityId,
      objectId: prAuthorId,
      attributes: {},
    });
    store.addRelation({
      relationType: "wasGeneratedBy",
      subjectId: prEntityId,
      objectId: reviewActivityId,
      attributes: {},
    });
    store.addRelation({
      relationType: "wasAssociatedWith",
      subjectId: reviewActivityId,
      objectId: prAuthorId,
      role: "author",
      attributes: {},
    });
    relations += 3;

    if (pr.reviewer) {
      store.addRelation({
        relationType: "wasAssociatedWith",
        subjectId: reviewActivityId,
        objectId: `agent:github:${pr.reviewer}`,
        role: "reviewer",
        attributes: {},
      });
      relations++;
    }

    step++;
    await onStep?.({
      progressPct: Math.round((step / Math.max(totalSteps, 1)) * 100),
      itemsProcessed: items,
      relationsCreated: relations,
      message: `Loaded GitHub PR #${pr.number} (${pr.state})`,
    });
    await sleep(stepDelayMs);
  }

  return { itemsProcessed: items, relationsCreated: relations };
}
