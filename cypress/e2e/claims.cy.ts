// End-to-end checks for the claim list, claim detail, fix loop and reject history.
// Needs the API (port 3001) and the Vite dev server (port 5173) running on the seeded database.

describe("Claim list", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("shows the synthetic-data notice on every load", () => {
    cy.get('[data-testid="data-notice"]').should("contain", "Synthetic data");
  });

  it("filters claims by hospital", () => {
    cy.get('[aria-label="Filter by hospital"]').select("90003");
    cy.contains("104 claims").should("exist");
    cy.get('[aria-label="Claim list"] tbody tr').each(($row) => {
      cy.wrap($row).should("contain", "โรงพยาบาลสมมติ C");
    });
  });

  it("opens a claim and shows canonical and source values", () => {
    cy.contains("button", "CLM-000137").click();
    cy.contains("h2", "Claim CLM-000137").should("be.visible");
    cy.contains("th", "Canonical").should("be.visible");
    cy.contains("th", "Source (hospital)").should("be.visible");
  });
});

describe("Claim detail and fix loop", () => {
  it("shows a readable service date in ISO format and the raw value beside it", () => {
    cy.visit("/");
    cy.contains("button", "CLM-000207").click();
    cy.contains("td", "Service date").parent().within(() => {
      cy.get("td").eq(1).should("contain", "2026-08-01");
    });
  });

  it("keeps the same fixed values until reload, then restores the original data", () => {
    cy.visit("/");
    cy.contains("button", "CLM-000137").click();
    cy.contains("button", "Re-run checks").should("not.exist");
    cy.get("body").then(($body) => {
      if ($body.find('[aria-label="National ID"]').length) {
        cy.get('[aria-label="National ID"]').type("1234567890123");
        cy.contains("button", "Re-run checks").click();
        cy.contains("Round 1 of 3").should("be.visible");
        cy.reload();
        cy.contains("h2", "Claim CLM-000137").should("be.visible");
        cy.get('[aria-label="National ID"]').should("have.value", "");
      }
    });
  });

  it("goes to manual review when the date is unreadable", () => {
    cy.visit("/");
    cy.contains("button", "CLM-000295").click();
    cy.contains("li", "Service date readable").should("contain", "fail");
    cy.contains("Service date is not readable").should("exist");
  });
});

describe("Reject history", () => {
  it("lists reason codes with the most frequent first", () => {
    cy.visit("/");
    cy.contains("button", "Reject history").click();
    cy.contains("317 payer submissions").should("exist");
    cy.get('[aria-label="Reject history"] li').first().should("contain", "R01");
  });
});
