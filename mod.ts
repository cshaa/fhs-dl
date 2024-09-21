#!/bin/env bun
import { $ } from "bun";
import { args } from "@typek/clap";
import { FormData, retry, type RetryOptions } from "@typek/typek";
import { mkdir } from "node:fs/promises";

const DEFAULT_RETRY_OPTIONS = { count: 3, delay: 50, exponentialBackoff: 10 };

const yeet = (msg: string) => {
  console.error(msg);
  process.exit(1);
};

const cookie = new Headers({
  Cookie:
    args.get("--cookie") ??
    yeet(
      "No cookie specified. Please log in to https://media.fhs.cuni.cz in your browser, " +
        "then open the console, enter `document.cookie` and copy the result. Then, pass the" +
        "result into this program via the `--cookie` flag."
    ),
});

const directory =
  args.get("--dir") ??
  yeet(
    "Target directory not specified. Please specify a directory using the `--dir` flag."
  );
mkdir(directory, { recursive: true });

interface VideoItem {
  Guid: string;
  Name: string;
  Description: string;
  NameLocalized: string;
  DescriptionLocalized: string;
  FileNameSuffix: string;
  OwnerUserId: number;
  MediaAccessLevelId: number;
  MediaTypeId: number;
  MediaFolderId: number;
  ShowOnlyToAuthenticated: true;
  ShowOnlyToAffiliated: true;
  ShowOnlyToListed: false;
  ShowOnlyToIpList: false;
  DurationSeconds: number;
  Author: string;
  Lat: number;
  Lon: number;
  CreatedUtc: string;
  LastMediaStatusChangedUtc: string;
  AuthorFormated: string;
  GuidSimple: string;
  MediaSnapShotUrl: string;
  MediaTypeName: "Video";
  MediaAccessLevelName: string;
  DurationSecondsFormatted: string;
  HasDuration: boolean;
  StreamStatusId: number;
  StreamStartTimeUtc: string | null;
  StreamCountdownMessage: string;
}
interface VideosPage {
  Success: boolean;
  Message: string;
  Data: {
    CurrentPage: number;
    TotalPages: number;
    TotalItems: number;
    ItemsPerPage: number;
    Items: VideoItem[];
  };
  Context: unknown;
}
async function getVideosPage({
  size,
  index,
  retry: retryOptions,
}: {
  size: number;
  index: number;
  retry?: RetryOptions;
}): Promise<VideosPage> {
  retryOptions ??= DEFAULT_RETRY_OPTIONS;

  return retry(retryOptions, async () =>
    (
      await fetch("https://media.fhs.cuni.cz/cs/MediaAjax/Search", {
        method: "POST",
        body: FormData.from({
          Lang: "cs",
          Q: "",
          MediaTypeId: "0",
          MediaCriteriaValueIds: "",
          MediaFolderId: "0",
          MediaAccessLevelId: "0",
          TagIds: "",
          Page: index.toString(),
          PageSize: size.toString(),
          OrderBy: "LastMediaStatusChangedUtc",
          OrderByAsc: "false",
        }),
        headers: cookie,
      })
    ).json()
  );
}
async function* getVideos({
  pageSize: size,
  retry,
}: {
  pageSize: number;
  retry?: RetryOptions;
}): AsyncIterableIterator<VideoItem> {
  let index = 0;
  while (true) {
    const page = await getVideosPage({ index: index++, size, retry });
    yield* page.Data.Items;

    if (page.Data.CurrentPage >= page.Data.TotalPages) break;
  }
}
function getVideoUrl({
  guid,
  retry: retryOptions,
}: {
  guid: string;
  retry?: RetryOptions;
}): Promise<string> {
  retryOptions ??= DEFAULT_RETRY_OPTIONS;

  return retry(retryOptions, async () => {
    const rewriter = new HTMLRewriter();
    let url: string | undefined;
    rewriter.on("video > source", {
      element(el) {
        const src = el.getAttribute("src");
        if (src) url = src.replaceAll("&amp;", "&"); // bug in HTMLRewriter
      },
    });
    rewriter.transform(
      await (
        await fetch(`https://media.fhs.cuni.cz/cs/media/${guid}`, {
          headers: cookie,
        })
      ).text()
    );
    if (!url) throw new Error(`Could not get URL for video ${guid}`);
    return url!;
  });
}

for await (const video of getVideos({ pageSize: 10 })) {
  try {
    const url = await getVideoUrl({ guid: video.Guid });
    await $`ffmpeg -n -i ${url} -codec copy "${directory}/${video.Name} ${
      video.Author ? `(${video.Author})` : ""
    } - ${video.Guid}.mp4"`;
  } catch (_) {
    console.error(`Could not fetch video ${video.Name} (${video.Guid})`);
  }
}
