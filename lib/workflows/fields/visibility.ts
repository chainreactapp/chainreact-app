/**
 * Centralized Field Visibility System
 *
 * Single source of truth for evaluating field visibility conditions across all workflow nodes.
 * Supports both modern declarative conditions and legacy patterns during migration.
 *
 * This engine is used by:
 * - useFieldValidation hook (for validation)
 * - GenericConfiguration (for rendering)
 * - Any component that needs to evaluate field visibility
 */

/**
 * Visibility condition interface
 * Supports simple conditions, compound logic (AND/OR/NOT), and nested conditions
 */
export interface VisibilityCondition {
  // Simple field-based condition
  field?: string;
  operator?:
    | 'equals'          // Field value equals expected value
    | 'notEquals'       // Field value does not equal expected value
    | 'in'              // Field value is in array of expected values
    | 'notIn'           // Field value is not in array of expected values
    | 'isEmpty'         // Field is empty/null/undefined
    | 'isNotEmpty'      // Field has a value
    | 'greaterThan'     // Numeric comparison
    | 'lessThan'        // Numeric comparison
    | 'greaterThanOrEqual' // Numeric comparison
    | 'lessThanOrEqual'    // Numeric comparison
    | 'contains'        // String contains substring
    | 'startsWith'      // String starts with substring
    | 'endsWith';       // String ends with substring
  value?: any;

  // Compound conditions
  and?: VisibilityCondition[];  // All conditions must be true
  or?: VisibilityCondition[];   // At least one condition must be true
  not?: VisibilityCondition;    // Condition must be false
}

/**
 * Legacy visibility patterns (supported during migration)
 */
export interface LegacyVisibilityPatterns {
  // Old pattern: { conditional: { field: 'action', value: 'create' } }
  conditional?: {
    field: string;
    value: any;
  };

  // Old pattern: { conditionalVisibility: { field: 'action', value: 'create' } }
  conditionalVisibility?: {
    field: string;
    value: any;
  };

  // Old pattern: { visibleWhen: { field: 'type', equals: 'webhook' } } or { visibleWhen: { field: 'type', value: 'webhook' } }
  visibleWhen?: {
    field: string;
    equals?: any;  // Legacy property
    value?: any;   // More common property used in schemas
  };

  // Old pattern: { showWhen: { action: { $in: ['create', 'update'] } } }
  showWhen?: Record<string, any>;

  // Old pattern: { dependsOn: 'workspace' } - field only visible if parent has value
  dependsOn?: string;

  // Old pattern: { hidden: true } or { hidden: { $condition: { field: { $exists: true } } } }
  hidden?: boolean | {
    $condition?: Record<string, any>;
  };

  // Pattern: { showIf: (values) => values.field === 'someValue' }
  showIf?: (values: Record<string, any>) => boolean;
}

export interface Field extends LegacyVisibilityPatterns {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  validation?: {
    required?: boolean;
  };
  visibilityCondition?: VisibilityCondition | 'always';
  advanced?: boolean;
}

/**
 * Centralized field visibility evaluation engine
 */
export class FieldVisibilityEngine {
  /**
   * Main entry point: Evaluate if a field should be visible
   */
  static isFieldVisible(
    field: Field,
    formValues: Record<string, any>,
    nodeInfo?: any
  ): boolean {
    // Type='hidden' always hidden
    if (field.type === 'hidden') return false;

    // Check showIf function FIRST - it can override hidden: true
    // Pattern: { hidden: true, showIf: (values) => values.field === 'someValue' }
    // The field is hidden by default but shown when showIf returns true
    if (typeof field.showIf === 'function') {
      const showIfResult = field.showIf(formValues);
      // If showIf returns true, show the field (override hidden: true)
      if (showIfResult) return true;
      // If showIf returns false, hide the field
      return false;
    }

    // Check explicit hidden flag (simple boolean or complex condition)
    if (field.hidden !== undefined) {
      // Simple boolean: { hidden: true }
      if (field.hidden === true) return false;

      // Complex condition: { hidden: { $condition: { field: { $exists: true } } } }
      if (typeof field.hidden === 'object' && field.hidden.$condition) {
        const condition = field.hidden.$condition;

        // Handle $or operator for multiple condition groups
        if ('$or' in condition && Array.isArray(condition.$or)) {
          // For $or, hide if ANY condition is true
          const anyConditionMet = condition.$or.some((orCondition: Record<string, any>) => {
            // Each orCondition is an object like { separateTimezones: { $eq: false } }
            for (const [dependentField, conditionValue] of Object.entries(orCondition)) {
              const actualValue = formValues[dependentField];
              const isEmpty = !actualValue || actualValue === '';

              // Handle MongoDB-style operators
              if (typeof conditionValue === 'object' && conditionValue !== null) {
                for (const [operator, expectedValue] of Object.entries(conditionValue)) {
                  switch (operator) {
                    case '$exists':
                      // $exists: false means condition is met when field is empty
                      if (expectedValue === false && isEmpty) return true;
                      // $exists: true means condition is met when field has value
                      if (expectedValue === true && !isEmpty) return true;
                      break;
                    case '$eq':
                      if (actualValue === expectedValue) return true;
                      break;
                    case '$ne':
                      if (actualValue !== expectedValue) return true;
                      break;
                    default:
                      if (actualValue === expectedValue) return true;
                  }
                }
              } else {
                // Simple value check
                if (actualValue === conditionValue) return true;
              }
            }
            return false;
          });

          if (anyConditionMet) return false; // Hide if any OR condition is true
        } else {
          // Original logic for non-$or conditions
          // Evaluate each condition in the $condition object
          for (const [dependentField, conditionValue] of Object.entries(condition)) {
            const actualValue = formValues[dependentField];

            // Handle MongoDB-style operators
            if (typeof conditionValue === 'object' && conditionValue !== null) {
              for (const [operator, expectedValue] of Object.entries(conditionValue)) {
                switch (operator) {
                  case '$exists':
                    // $exists: false means "hide when field doesn't exist (no value)"
                    // $exists: true means "hide when field exists (has value)"
                    if (expectedValue === false) {
                      if (!actualValue || actualValue === '') return false;
                    } else if (expectedValue === true) {
                      if (actualValue && actualValue !== '') return false;
                    }
                    break;
                  case '$eq':
                    if (actualValue === expectedValue) return false;
                    break;
                  case '$ne':
                    if (actualValue !== expectedValue) return false;
                    break;
                  default:
                    // For unknown operators, treat as equality
                    if (actualValue === expectedValue) return false;
                }
              }
            } else {
              // Simple value check - hide if values match
              if (actualValue === conditionValue) return false;
            }
          }
        }
      }
    }

    // Modern pattern: visibilityCondition
    // Note: This should NOT short-circuit other checks like dependsOn
    // Only return false if condition fails; if it passes, continue checking other conditions
    if (field.visibilityCondition !== undefined) {
      if (field.visibilityCondition === 'always') {
        // Continue to check other conditions (don't return immediately)
      } else if (typeof field.visibilityCondition === 'object') {
        if (!this.evaluateCondition(field.visibilityCondition, formValues)) {
          return false; // If visibility condition fails, hide field immediately
        }
        // If visibility condition passes, continue to check other conditions like dependsOn
      }
    }

    // Pre-migration pattern shapes — `conditional`, `conditionalVisibility`,
    // `visibleWhen`, `showWhen`. Migration to the canonical `visibilityCondition`
    // shape is tracked in learning/docs/visibility-migration-progress.md
    // (~130 occurrences across 25+ schema files; remove these branches once
    // the migration completes).

    // Pattern: { conditional: { field: 'action', value: 'create' } }
    if (field.conditional) {
      const { field: dependentField, value: expectedValue } = field.conditional;
      const actualValue = formValues[dependentField];
      if (actualValue !== expectedValue) return false;
    }

    // Pattern: { conditionalVisibility: { field: 'action', value: 'create' } }
    if (field.conditionalVisibility) {
      const { field: dependentField, value: expectedValue } = field.conditionalVisibility;
      const actualValue = formValues[dependentField];

      // Special handling for boolean true - check for any truthy value
      if (expectedValue === true && typeof expectedValue === 'boolean') {
        if (!actualValue || (typeof actualValue === 'string' && actualValue.trim() === '')) {
          return false;
        }
      }
      // Special handling for boolean false - check for falsy value
      else if (expectedValue === false && typeof expectedValue === 'boolean') {
        if (actualValue && !(typeof actualValue === 'string' && actualValue.trim() === '')) {
          return false;
        }
      }
      // For other values, check exact match
      else if (actualValue !== expectedValue) {
        return false;
      }
    }

    // Pattern: { visibleWhen: { field: 'type', equals: 'webhook' } } or { visibleWhen: { field: 'type', value: 'webhook' } }
    if (field.visibleWhen) {
      const { field: dependentField, equals, value } = field.visibleWhen as any;
      // Support both 'equals' and 'value' properties (value is more common in schemas)
      const expectedValue = equals !== undefined ? equals : value;
      const actualValue = formValues[dependentField];
      if (actualValue !== expectedValue) return false;
    }

    // Pattern: { showWhen: { action: { $in: ['create', 'update'] } } }
    if (field.showWhen) {
      for (const [dependentField, condition] of Object.entries(field.showWhen)) {
        const actualValue = formValues[dependentField];

        // Handle MongoDB-style operators
        if (typeof condition === 'object' && condition !== null) {
          // MongoDB-style operators
          for (const [operator, expectedValue] of Object.entries(condition)) {
            switch (operator) {
              case '$in':
                if (!Array.isArray(expectedValue) || !expectedValue.includes(actualValue)) {
                  return false;
                }
                break;
              case '$ne': // not equal
                if (actualValue === expectedValue) return false;
                break;
              case '$eq': // equal
                if (actualValue !== expectedValue) return false;
                break;
              case '$exists': // field exists/has value
                if (expectedValue && (!actualValue || actualValue === '')) return false;
                if (!expectedValue && actualValue && actualValue !== '') return false;
                break;
              case '$gt': // greater than
                if (!(actualValue > expectedValue)) return false;
                break;
              case '$lt': // less than
                if (!(actualValue < expectedValue)) return false;
                break;
              default:
                // Unknown operator, treat as equality check
                if (actualValue !== expectedValue) return false;
            }
          }
        } else {
          // Handle special string conditions
          if (condition === "!empty") {
            // Check if field has a value (not empty, null, or undefined)
            if (!actualValue || (typeof actualValue === 'string' && actualValue.trim() === '')) {
              return false;
            }
          } else if (condition === "empty") {
            // Check if field is empty
            if (actualValue && (typeof actualValue !== 'string' || actualValue.trim() !== '')) {
              return false;
            }
          } else {
            // Simple equality check (legacy format)
            if (actualValue !== condition) return false;
          }
        }
      }
    }

    // Pattern: { dependsOn: 'workspace' }
    if (field.dependsOn) {
      const parentValue = formValues[field.dependsOn];
      if (!parentValue || parentValue === '') return false;
    }

    // Provider-specific visibility rules (temporary - should migrate to declarative)
    if (nodeInfo?.providerId) {
      const providerOverride = this.evaluateProviderSpecificRules(field, formValues, nodeInfo);
      if (providerOverride !== null) return providerOverride;
    }

    return true;
  }

  /**
   * Evaluate a modern visibility condition
   */
  static evaluateCondition(
    condition: VisibilityCondition,
    formValues: Record<string, any>
  ): boolean {
    // Handle compound conditions
    if (condition.and) {
      return condition.and.every(c => this.evaluateCondition(c, formValues));
    }

    if (condition.or) {
      return condition.or.some(c => this.evaluateCondition(c, formValues));
    }

    if (condition.not) {
      return !this.evaluateCondition(condition.not, formValues);
    }

    // Handle simple field-based condition
    if (!condition.field) return true;

    const fieldValue = formValues[condition.field];
    return this.evaluateOperator(condition.operator, fieldValue, condition.value);
  }

  /**
   * Evaluate an operator against field value and expected value
   */
  private static evaluateOperator(
    operator: string | undefined,
    fieldValue: any,
    expectedValue: any
  ): boolean {
    switch (operator) {
      case 'equals':
        return fieldValue === expectedValue;

      case 'notEquals':
        return fieldValue !== expectedValue;

      case 'in':
        return Array.isArray(expectedValue) && expectedValue.includes(fieldValue);

      case 'notIn':
        return Array.isArray(expectedValue) && !expectedValue.includes(fieldValue);

      case 'isEmpty':
        return !fieldValue ||
               fieldValue === '' ||
               (Array.isArray(fieldValue) && fieldValue.length === 0) ||
               (typeof fieldValue === 'object' && !Array.isArray(fieldValue) && Object.keys(fieldValue).length === 0);

      case 'isNotEmpty':
        return Boolean(fieldValue) &&
               fieldValue !== '' &&
               (!Array.isArray(fieldValue) || fieldValue.length > 0) &&
               (typeof fieldValue !== 'object' || Array.isArray(fieldValue) || Object.keys(fieldValue).length > 0);

      case 'greaterThan':
        return Number(fieldValue) > Number(expectedValue);

      case 'lessThan':
        return Number(fieldValue) < Number(expectedValue);

      case 'greaterThanOrEqual':
        return Number(fieldValue) >= Number(expectedValue);

      case 'lessThanOrEqual':
        return Number(fieldValue) <= Number(expectedValue);

      case 'contains':
        return String(fieldValue).toLowerCase().includes(String(expectedValue).toLowerCase());

      case 'startsWith':
        return String(fieldValue).toLowerCase().startsWith(String(expectedValue).toLowerCase());

      case 'endsWith':
        return String(fieldValue).toLowerCase().endsWith(String(expectedValue).toLowerCase());

      default:
        // Unknown operator - default to true to avoid breaking fields
        return true;
    }
  }

  /**
   * Provider-specific visibility rules
   * TODO: Migrate these to declarative visibilityCondition in node schemas
   */
  private static evaluateProviderSpecificRules(
    field: Field,
    formValues: Record<string, any>,
    nodeInfo: any
  ): boolean | null {
    const providerId = nodeInfo.providerId;

    // Airtable-specific rules
    if (providerId === 'airtable') {
      // Dynamic field fields are only shown when tableName is selected and schema is loaded
      if (field.name.startsWith('airtable_field_')) {
        if (!formValues.tableName) return false;
      }

      // recordId field is only needed for update action
      if (field.name === 'recordId' && nodeInfo.type === 'airtable_action_create_record') {
        return false;
      }

      // Filter fields only for list records action
      if ((field.name === 'filterField' || field.name === 'filterValue') &&
          nodeInfo.type !== 'airtable_action_list_records') {
        return false;
      }
    }

    // Google Sheets-specific rules
    if (providerId === 'google-sheets') {
      // Update-specific fields only visible when action is 'update'
      if (field.name.startsWith('updateMapping.') && formValues.action !== 'update') {
        return false;
      }

      // Range field only for read action
      if (field.name === 'range' && formValues.action !== 'read') {
        return false;
      }
    }

    // Discord-specific rules
    if (providerId === 'discord') {
      // Message ID only needed for certain actions
      if (field.name === 'messageId') {
        const needsMessage = [
          'discord_action_edit_message',
          'discord_action_delete_message',
          'discord_action_add_reaction',
          'discord_action_remove_reaction'
        ].includes(nodeInfo.type);

        if (!needsMessage) return false;
      }

      // Emoji field only for reaction actions
      if (field.name === 'emoji') {
        const needsEmoji = [
          'discord_action_add_reaction',
          'discord_action_remove_reaction'
        ].includes(nodeInfo.type);

        if (!needsEmoji) return false;
      }
    }

    return null; // No provider-specific override
  }

  /**
   * Get all visible fields from a schema
   */
  static getVisibleFields(
    schema: Field[],
    formValues: Record<string, any>,
    nodeInfo?: any
  ): Field[] {
    return schema.filter(field => this.isFieldVisible(field, formValues, nodeInfo));
  }

  /**
   * Get missing required fields (only from visible fields)
   */
  static getMissingRequiredFields(
    schema: Field[],
    formValues: Record<string, any>,
    nodeInfo?: any
  ): string[] {
    const visibleFields = this.getVisibleFields(schema, formValues, nodeInfo);

    const missingFields = visibleFields
      .filter(field => field.required || field.validation?.required)
      .filter(field => {
        const value = formValues[field.name];

        // AI values are considered valid
        if (typeof value === 'string' && /^\{\{AI_FIELD:.+\}\}$/.test(value)) {
          return false;
        }

        // Check if empty
        return !value ||
               value === '' ||
               (Array.isArray(value) && value.length === 0) ||
               (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
      })
      .map(field => field.name);

    // Debug logging for Get Record
    if (nodeInfo?.type === 'airtable_action_get_record') {
      console.log('🔍 [Get Record Validation]', {
        allFields: schema.map(f => f.name),
        visibleFields: visibleFields.map(f => f.name),
        visibleRequiredFields: visibleFields.filter(f => f.required).map(f => f.name),
        formValues: Object.keys(formValues).reduce((acc, key) => {
          acc[key] = typeof formValues[key] === 'object' ? JSON.stringify(formValues[key]) : formValues[key];
          return acc;
        }, {} as Record<string, any>),
        missingFields
      });
    }

    // Debug logging for Add Attachment
    if (nodeInfo?.type === 'airtable_action_add_attachment') {
      console.log('🔍 [Add Attachment Validation]', {
        allFields: schema.map(f => f.name),
        visibleFields: visibleFields.map(f => f.name),
        visibleRequiredFields: visibleFields.filter(f => f.required).map(f => f.name),
        formValues: formValues,
        missingFields: missingFields
      });
    }

    return missingFields;
  }

  /**
   * Get all visible required fields (used for displaying complete list)
   */
  static getVisibleRequiredFields(
    schema: Field[],
    formValues: Record<string, any>,
    nodeInfo?: any
  ): string[] {
    const visibleFields = this.getVisibleFields(schema, formValues, nodeInfo);

    return visibleFields
      .filter(field => field.required || field.validation?.required)
      .map(field => field.name);
  }

  /**
   * Validate that all visible required fields have values
   */
  static validate(
    schema: Field[],
    formValues: Record<string, any>,
    nodeInfo?: any
  ): { isValid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    const missingFields = this.getMissingRequiredFields(schema, formValues, nodeInfo);

    missingFields.forEach(fieldName => {
      const field = schema.find(f => f.name === fieldName);
      const fieldLabel = field?.label || fieldName;

      // Special error message for tags fields to remind users to press Enter
      if (field?.type === 'tags') {
        errors[fieldName] = `${fieldLabel} is required. Please type in a keyword and press Enter.`;
      } else {
        errors[fieldName] = `${fieldLabel} is required`;
      }
    });

    return {
      isValid: missingFields.length === 0,
      errors
    };
  }
}
