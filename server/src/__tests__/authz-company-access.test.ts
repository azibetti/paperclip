import { describe, expect, it } from "vitest";
import { assertCompanyAccess } from "../routes/authz.js";

function makeReq(input: {
  method?: string;
  actor: Express.Request["actor"];
}) {
  return {
    method: input.method ?? "GET",
    actor: input.actor,
  } as Express.Request;
}

describe("assertCompanyAccess", () => {
  it("allows viewer memberships to read", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [
          { companyId: "company-1", membershipRole: "viewer", status: "active" },
        ],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).not.toThrow();
  });

  it("rejects viewer memberships for writes", () => {
    const req = makeReq({
      method: "PATCH",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [
          { companyId: "company-1", membershipRole: "viewer", status: "active" },
        ],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).toThrow("Viewer access is read-only");
  });
});
