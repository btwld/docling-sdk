/** Run with tsx after building and explicitly installing the reviewed runtime. */
import { NativeError, createNativeClient } from "../src/native-entry";

const [executable, modelDirectory, input, outputDirectory] = process.argv.slice(2);
if (!executable || !modelDirectory || !input || !outputDirectory) {
  throw new Error(
    "Usage: tsx examples/07-native-client.ts <executable> <models> <input> <output-root>"
  );
}
try {
  const client = createNativeClient({ executable, modelDirectory });
  const result = await client.convertFile(input, { outputDirectory, formats: ["md", "json"] });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "success") process.exitCode = 1;
} catch (error) {
  if (!(error instanceof NativeError)) throw error;
  console.error(`${error.code}: ${error.message}`);
  process.exitCode = 1;
}
