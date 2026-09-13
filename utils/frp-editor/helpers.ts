export function loadStylesheet(url: string): Promise<HTMLLinkElement> {
  return new Promise<HTMLLinkElement>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.onload = () => resolve(link);
    link.onerror = () => {
      link.remove();
      reject(new Error(`Unable to load Monaco stylesheet from ${url}.`));
    };
    document.head.appendChild(link);
  });
}

export function createModuleWorker(url: string): Worker {
  return createModuleWorkerFromSource(`import ${JSON.stringify(url)};`);
}

export function createModuleWorkerFromSource(source: string): Worker {
  const blob = new Blob([source], {
    type: "application/javascript",
  });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return new Worker(blobUrl, { type: "module" });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function importRemoteModule<T>(url: string): Promise<T> {
  const dynamicImport = Function("url", "return import(url);") as (
    moduleUrl: string,
  ) => Promise<T>;
  return dynamicImport(url);
}

export function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Monaco CDN request timed out.")),
      milliseconds,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function backgroundLuminance(element: HTMLElement): number | undefined {
  const color = getComputedStyle(element)
    .backgroundColor.match(/\d+/g)
    ?.map(Number);
  if (!color || color.length < 3 || color[3] === 0) return undefined;
  return color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
}

export function prefersDarkTheme(): boolean {
  for (const element of [document.body, document.documentElement]) {
    const luminance = backgroundLuminance(element);
    if (luminance !== undefined) return luminance < 128;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
