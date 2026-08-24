export type IdentityInput = {
  id: string;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
};

export type WorkIdentity = {
  id: string;
  username: string;
  workEmail: string;
};

function compact(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("en-IN").replace(/[^a-z0-9]/g, "");
}

export function buildIdentityPlan(inputs: readonly IdentityInput[]): WorkIdentity[] {
  const prepared = inputs.map((input) => {
    const firstName = compact(input.firstName);
    const lastName = compact(input.lastName);
    const username = `${firstName}${lastName}`;
    if (!firstName || !username) throw new Error(`Invalid identity name for ${input.id}`);
    return { id: input.id, firstName, lastName, username };
  });

  const duplicateUsername = prepared.find((item, index) => prepared.findIndex((candidate) => candidate.username === item.username) !== index);
  if (duplicateUsername) throw new Error(`Duplicate username: ${duplicateUsername.username}`);

  const firstNameCounts = new Map<string, number>();
  for (const item of prepared) firstNameCounts.set(item.firstName, (firstNameCounts.get(item.firstName) ?? 0) + 1);

  return prepared.map((item) => ({
    id: item.id,
    username: item.username,
    workEmail: firstNameCounts.get(item.firstName) === 1
      ? `${item.firstName}mkjewels@gmail.com`
      : `${item.firstName}.${item.lastName}mkjewels@gmail.com`,
  }));
}
