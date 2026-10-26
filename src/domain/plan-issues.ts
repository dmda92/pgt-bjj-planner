import {sizeMessage, type SizeDetails} from "./json-limits.ts";

/** A recoverable projection failure, never an authorization/transport failure. */
export interface PlanIssue {
    planId: string;
    code: "PLAN_TOO_LARGE" | "NO_TRAINABLE_TECHNIQUES";
    size?: SizeDetails;
}

export function planIssueMessage(issues: PlanIssue[]): string {
    return "Sincronización incompleta: " + issues.map(issue => issue.code === "PLAN_TOO_LARGE"
        ? sizeMessage(issue.size!)
        : `Plan ${issue.planId}: añade al menos una técnica entrenable y vuelve a sincronizar.`).join(" · ");
}
