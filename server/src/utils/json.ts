export async function parseJSON<T>(data: string): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      resolve(JSON.parse(data));
    } catch (error) {
      reject("[Glock] Unable to parse data: " + error);
    }
  });
}

export function stringifyJSON<T>(data: T): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      resolve(JSON.stringify(data));
    } catch (error) {
      reject("[Glock] Unable to stringify data: " + error);
    }
  });
}
