import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DESCRIPTION_MAX_CHARS,
  type SchemaProp,
  type StringProp,
  FORBIDDEN_PROPERTY_NAMES,
  OUTPUT_BUDGETS,
  TOOLS,
  TOOL_ORDER,
  listTools,
  renderReason,
  renderTitle,
  schemaPropertyNames,
  NOT_NOW_REASONS,
} from './schema';

function str(prop: SchemaProp): StringProp {
  assert.equal(prop.type, 'string');
  return prop as StringProp;
}

test('exactly eight tools, in rail order, with matching names', () => {
  assert.equal(TOOL_ORDER.length, 8);
  assert.deepEqual(TOOL_ORDER, [
    'find_open_rules',
    'open_rule',
    'read_rule',
    'propose_claim',
    'propose_edit',
    'draft_my_impact',
    'get_letter',
    'ask_person_to_file',
  ]);
  assert.deepEqual(Object.keys(TOOLS).sort(), [...TOOL_ORDER].sort());
  for (const tool of listTools()) assert.equal(TOOLS[tool.name].name, tool.name);
});

test('descriptions are ≤ 500 chars and carry the required phrases', () => {
  for (const tool of listTools()) {
    assert.ok(
      tool.description.length <= DESCRIPTION_MAX_CHARS,
      `${tool.name} description is ${tool.description.length} chars`,
    );
    assert.ok(tool.description.length > 80, `${tool.name} description is too short to be useful`);
  }
  assert.ok(
    TOOLS.propose_claim.description.includes(
      'Nothing applies until a person holds Accept; there is no accept tool.',
    ),
  );
  assert.ok(
    TOOLS.propose_claim.description.includes(
      'quotes must be copied from read_rule output served in this session (verifier norm-1)',
    ),
  );
  assert.ok(
    TOOLS.draft_my_impact.description.includes(
      'identity comes from the Sign in with ChatGPT session, never from arguments',
    ),
  );
});

test('every schema is a closed object with explicit annotations', () => {
  for (const tool of listTools()) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} additionalProperties`);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof tool.annotations.untrustedContentHint, 'boolean');
    assert.ok(tool.hint_reasons.read_only.length > 0);
    assert.ok(tool.hint_reasons.untrusted.length > 0);
    assert.ok(tool.appears_when.length > 0);
    assert.equal(tool.output_budget, OUTPUT_BUDGETS[tool.name]);
    for (const req of tool.inputSchema.required ?? []) {
      assert.ok(req in tool.inputSchema.properties, `${tool.name} requires unknown ${req}`);
    }
    for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
      assert.ok(prop.description.length > 0, `${tool.name}.${key} has a description`);
      if (prop.type === 'string') {
        assert.ok(
          prop.maxLength !== undefined || prop.enum !== undefined || prop.pattern !== undefined,
          `${tool.name}.${key} is bounded`,
        );
      }
    }
  }
});

test('no schema property is named name/display_name/signer/user_id/email', () => {
  for (const tool of listTools()) {
    const names = schemaPropertyNames(tool.inputSchema);
    for (const forbidden of FORBIDDEN_PROPERTY_NAMES) {
      assert.ok(!names.includes(forbidden), `${tool.name} must not accept ${forbidden}`);
    }
  }
});

test('section 3 specifics: enums, patterns, budgets, read-only flags', () => {
  assert.deepEqual(str(TOOLS.propose_claim.inputSchema.properties.position).enum, [
    'support',
    'oppose',
    'modify',
  ]);
  assert.deepEqual(str(TOOLS.propose_edit.inputSchema.properties.field).enum, [
    'quote',
    'assertion',
    'requested_change',
    'evidence',
    'position',
  ]);
  assert.equal(
    str(TOOLS.open_rule.inputSchema.properties.document_number).pattern,
    '^\\d{4}-\\d{4,6}$',
  );
  assert.equal(str(TOOLS.propose_edit.inputSchema.properties.claim_id).pattern, '^c_[a-z0-9]{8}$');
  assert.equal(str(TOOLS.propose_claim.inputSchema.properties.base_rev).pattern, '^[a-f0-9]{12}$');
  assert.deepEqual(TOOLS.propose_claim.inputSchema.required, [
    'base_rev',
    'quote',
    'position',
    'assertion',
  ]);
  assert.deepEqual(TOOLS.propose_edit.inputSchema.required, [
    'base_rev',
    'claim_id',
    'field',
    'text',
  ]);
  assert.deepEqual(TOOLS.draft_my_impact.inputSchema.required, ['base_rev', 'text']);
  assert.deepEqual(Object.keys(TOOLS.get_letter.inputSchema.properties), []);
  assert.deepEqual(Object.keys(TOOLS.ask_person_to_file.inputSchema.properties), []);

  assert.equal(OUTPUT_BUDGETS.find_open_rules, 1800);
  assert.equal(OUTPUT_BUDGETS.get_letter, 1800);
  assert.equal(OUTPUT_BUDGETS.read_rule, 4500);
  assert.equal(OUTPUT_BUDGETS.propose_claim, 1500);

  const readOnly = listTools()
    .filter(t => t.annotations.readOnlyHint)
    .map(t => t.name);
  assert.deepEqual(readOnly, ['find_open_rules', 'read_rule', 'get_letter', 'ask_person_to_file']);
  assert.equal(TOOLS.draft_my_impact.annotations.untrustedContentHint, false);
  assert.equal(TOOLS.ask_person_to_file.annotations.untrustedContentHint, false);
});

test('title and reason templates render', () => {
  assert.equal(
    renderTitle(TOOLS.read_rule.title, {
      document_number: '2026-17902',
      total_chars: 44458,
      first_page: 56095,
      last_page: 56101,
    }),
    'Read passages of 2026-17902 (44,458 chars, pp. 56095-56101)',
  );
  assert.equal(
    renderTitle(TOOLS.draft_my_impact.title, { display_name: 'Maya' }),
    'Draft an impact statement for Maya',
  );
  assert.equal(
    renderReason(NOT_NOW_REASONS.bound, { document_number: '2026-17902' }),
    'letter is bound to 2026-17902',
  );
});
