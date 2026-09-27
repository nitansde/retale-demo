import {
  createPresetCompatRegisteredMacro,
  type PresetCompatRegisteredMacro,
} from '@/lib/preset-compat/macro-registry'

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatUtcDateParts(now: Date) {
  return {
    year: now.getUTCFullYear(),
    monthIndex: now.getUTCMonth(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
    weekdayIndex: now.getUTCDay(),
    hours: now.getUTCHours(),
    minutes: now.getUTCMinutes(),
    seconds: now.getUTCSeconds(),
  }
}

function formatDateTemplate(now: Date, template: string) {
  const parts = formatUtcDateParts(now)

  return template
    .replaceAll('YYYY', String(parts.year))
    .replaceAll('MMMM', MONTH_NAMES[parts.monthIndex])
    .replaceAll('dddd', WEEKDAY_NAMES[parts.weekdayIndex])
    .replaceAll('MM', pad(parts.month))
    .replaceAll('DD', pad(parts.day))
    .replaceAll('HH', pad(parts.hours))
    .replaceAll('mm', pad(parts.minutes))
    .replaceAll('ss', pad(parts.seconds))
}

function addInvalidArgumentsDiagnostic(message: string, macroName: string, context: Parameters<NonNullable<PresetCompatRegisteredMacro['evaluate']>>[0]['context']) {
  context.addDiagnostic({
    code: 'INVALID_ARGUMENTS',
    message,
    macroName,
  })
}

function parseIntegerArgument(rawValue: string, macroName: string, context: Parameters<NonNullable<PresetCompatRegisteredMacro['evaluate']>>[0]['context']) {
  const value = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(value)) {
    addInvalidArgumentsDiagnostic(`Macro requires an integer argument: ${macroName}`, macroName, context)
    return null
  }

  return value
}

function randomInt(context: Parameters<NonNullable<PresetCompatRegisteredMacro['evaluate']>>[0]['context'], min: number, max: number) {
  return Math.floor(context.random() * (max - min + 1)) + min
}

export function createPresetCompatRandomTimeMacroBuiltins(): PresetCompatRegisteredMacro[] {
  return [
    createPresetCompatRegisteredMacro({
      name: 'time',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'HH:mm'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'date',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'MMMM DD, YYYY'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'weekday',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'dddd'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'isotime',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'HH:mm:ss'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'isodate',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'YYYY-MM-DD'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'datetimeformat',
      evaluate: ({ context, resolvedArguments }) => {
        const format = resolvedArguments?.[0]?.trim()
        if (!format) {
          addInvalidArgumentsDiagnostic('Macro requires a date/time format string: datetimeformat', 'datetimeformat', context)
          return ''
        }

        return formatDateTemplate(context.getNow(), format)
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'roll',
      evaluate: ({ context, resolvedArguments }) => {
        if (!resolvedArguments?.length) {
          return String(randomInt(context, 1, 6))
        }

        if (resolvedArguments.length === 1) {
          const max = parseIntegerArgument(resolvedArguments[0], 'roll', context)
          if (max === null) {
            return ''
          }

          return String(randomInt(context, 1, max))
        }

        const min = parseIntegerArgument(resolvedArguments[0], 'roll', context)
        const max = parseIntegerArgument(resolvedArguments[1], 'roll', context)
        if (min === null || max === null || max < min) {
          addInvalidArgumentsDiagnostic('Macro requires roll min/max arguments in ascending order: roll', 'roll', context)
          return ''
        }

        return String(randomInt(context, min, max))
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'random',
      evaluate: ({ context, resolvedArguments }) => {
        if (!resolvedArguments?.length) {
          return String(context.random())
        }

        if (resolvedArguments.length === 1) {
          const max = parseIntegerArgument(resolvedArguments[0], 'random', context)
          if (max === null) {
            return ''
          }

          return String(randomInt(context, 0, max))
        }

        const min = parseIntegerArgument(resolvedArguments[0], 'random', context)
        const max = parseIntegerArgument(resolvedArguments[1], 'random', context)
        if (min === null || max === null || max < min) {
          addInvalidArgumentsDiagnostic('Macro requires random min/max arguments in ascending order: random', 'random', context)
          return ''
        }

        return String(randomInt(context, min, max))
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'pick',
      evaluate: ({ context, resolvedArguments }) => {
        if (!resolvedArguments?.length) {
          addInvalidArgumentsDiagnostic('Macro requires at least one pick option: pick', 'pick', context)
          return ''
        }

        const index = randomInt(context, 0, resolvedArguments.length - 1)
        return resolvedArguments[index] ?? ''
      },
    }),
  ]
}
