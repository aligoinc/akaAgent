export const createDefaultDataGroupName = (date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `Data ${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`
}
