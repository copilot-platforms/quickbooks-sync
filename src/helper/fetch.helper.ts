export const postFetcher = async (
  url: string,
  headers: Record<string, string>,
  body: Record<string, any>,
) => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body), // body data type must match "Content-Type" header
  })

  return response.json()
}

export const getFetcher = async (
  url: string,
  headers: Record<string, string>,
) => {
  const response = await fetch(url, { headers })
  return response.json()
}
