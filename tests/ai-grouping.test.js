const assert = require("node:assert/strict");
const {
  parseAiGroupingResponse,
  validateAiGroupingSuggestions,
  applyAiGroupingSuggestions
} = require("../core/ai-grouping.js");

function testParsesFencedAndProseJson() {
  assert.deepEqual(
    parseAiGroupingResponse("{\"groups\":[{\"name\":\"纯 JSON\",\"linkIds\":[\"link-a\"]}]}"),
    { groups: [{ name: "纯 JSON", linkIds: ["link-a"] }] }
  );
  assert.deepEqual(
    parseAiGroupingResponse("```json\n{\"groups\":[{\"name\":\"开发\",\"linkIds\":[\"link-a\"]}]}\n```"),
    { groups: [{ name: "开发", linkIds: ["link-a"] }] }
  );
  assert.deepEqual(
    parseAiGroupingResponse("建议如下：\n{\"groups\":[{\"name\":\"阅读\",\"linkIds\":[\"link-b\"]}]}\n请确认。"),
    { groups: [{ name: "阅读", linkIds: ["link-b"] }] }
  );
}

function testValidatesKnownUniqueLinkIds() {
  const suggestions = validateAiGroupingSuggestions({
    groups: [
      { name: "  开发工具  ", linkIds: ["link-a", "unknown", "link-a"] },
      { name: "资料", linkIds: ["link-a", "link-b", 42] }
    ]
  }, ["link-a", "link-b"]);

  assert.deepEqual(suggestions, {
    groups: [
      { name: "开发工具", linkIds: ["link-a"] },
      { name: "资料", linkIds: ["link-b"] }
    ]
  });
}

function testRejectsEmptySuggestions() {
  assert.throws(
    () => validateAiGroupingSuggestions({ groups: [{ name: "空组", linkIds: ["unknown"] }] }, ["link-a"]),
    /有效|分组/
  );
}

function createWorkspace() {
  return {
    version: 1,
    activeSpaceId: "space-a",
    spaces: [{
      id: "space-a",
      name: "工作",
      groups: [
        {
          id: "group-existing",
          name: "开发",
          links: [
            { id: "link-a", title: "A", url: "https://a.example", createdAt: 1 },
            { id: "link-b", title: "B", url: "https://b.example", createdAt: 2 }
          ],
          createdAt: 1
        },
        {
          id: "group-other",
          name: "其他",
          links: [
            { id: "link-c", title: "C", url: "https://c.example", createdAt: 3 },
            { id: "link-deleted", title: "Deleted", url: "https://deleted.example", createdAt: 4, deletedAt: 5 }
          ],
          createdAt: 1
        }
      ],
      createdAt: 1
    }],
    settings: {}
  };
}

function testAppliesByReusingAndCreatingGroupsWithoutCopies() {
  const input = createWorkspace();
  const result = applyAiGroupingSuggestions(input, "space-a", {
    groups: [
      { name: "开发", linkIds: ["link-c"] },
      { name: "阅读", linkIds: ["link-a", "link-deleted"] }
    ]
  });
  const space = result.spaces.find((item) => item.id === "space-a");
  const reused = space.groups.find((group) => group.id === "group-existing");
  const created = space.groups.find((group) => group.name === "阅读" && !group.deletedAt);
  const activeIds = space.groups
    .filter((group) => !group.deletedAt)
    .flatMap((group) => group.links.filter((link) => !link.deletedAt).map((link) => link.id));

  assert.ok(created);
  assert.deepEqual(reused.links.filter((link) => !link.deletedAt).map((link) => link.id), ["link-b", "link-c"]);
  assert.deepEqual(created.links.filter((link) => !link.deletedAt).map((link) => link.id), ["link-a"]);
  assert.equal(activeIds.filter((id) => id === "link-a").length, 1);
  assert.equal(activeIds.filter((id) => id === "link-c").length, 1);
  assert.equal(space.groups.find((group) => group.id === "group-other").links.some((link) => link.id === "link-deleted" && link.deletedAt), true);
  assert.deepEqual(input, createWorkspace());
}

function runTests() {
  testParsesFencedAndProseJson();
  testValidatesKnownUniqueLinkIds();
  testRejectsEmptySuggestions();
  testAppliesByReusingAndCreatingGroupsWithoutCopies();
  console.log("AI 分组测试通过");
}

runTests();
