export const OS_TAG = /^v(?:0|[1-9][0-9]{0,8})(?:\.(?:0|[1-9][0-9]{0,8})){2}$/;
export const OS_FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;

export async function latestOsTag(bucket: R2Bucket): Promise<string | null> {
  const tags: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "releases/", delimiter: "/", cursor });
    for (const directory of page.delimitedPrefixes) {
      const tag = directory.slice("releases/".length, -1);
      if (OS_TAG.test(tag)) tags.push(tag);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const versions = new Intl.Collator("en", { numeric: true });
  tags.sort((first, second) => versions.compare(second, first));
  for (const tag of tags) {
    if (await bucket.head(`releases/${tag}/manifest.json`)) return tag;
  }
  return null;
}

export async function latestOsRelease(bucket: R2Bucket, origin: string) {
  const tag = await latestOsTag(bucket);
  if (!tag) return null;
  const base = `${origin}/releases/${tag}`;
  const signature = await bucket.head(`releases/${tag}/manifest.json.sig`);
  return { tag, manifest_url: `${base}/manifest.json`, signature_url: signature ? `${base}/manifest.json.sig` : null };
}

export async function latestR36sRelease(bucket: R2Bucket, origin: string) {
  const tag = await latestOsTag(bucket);
  if (!tag) return null;
  const manifest = await bucket.get(`releases/${tag}/manifest.json`);
  const data = await manifest?.json<{
    tag?: string;
    schema_version?: number;
    boards?: { gameconsole?: { r36s?: { image?: { path?: string; checksum?: string } } } };
  }>().catch(() => null);
  const image = data?.boards?.gameconsole?.r36s?.image;
  if (data?.schema_version !== 1 || data.tag !== tag || typeof image?.path !== "string" ||
      typeof image.checksum !== "string" || !OS_FILE.test(image.path) || !OS_FILE.test(image.checksum)) return null;
  const base = `${origin}/releases/${tag}`;
  return {
    tag,
    base,
    image: `${base}/${image.path}`,
    filename: image.path.split("/").pop()!,
    checksum: `${base}/${image.checksum}`,
    shell: `${base}/flash.sh`,
    powershell: `${base}/flash.ps1`,
  };
}

export type R36sRelease = NonNullable<Awaited<ReturnType<typeof latestR36sRelease>>>;
