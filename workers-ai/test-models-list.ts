// Test script to verify OpenAI models.list() API
import { OpenAI } from "openai";

interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    try {
      // Test 1: List all available models
      console.log("=== Testing models.list() ===");
      const modelsList = await client.models.list();
      
      const models = [];
      for await (const model of modelsList) {
        models.push(model);
      }
      
      console.log(`Found ${models.length} models`);
      
      // Sample a few models to see structure
      const sampleModels = models.slice(0, 5).map(m => ({
        id: m.id,
        object: m.object,
        created: m.created,
        owned_by: m.owned_by,
      }));

      // Test 2: Get specific model details
      console.log("\n=== Testing models.retrieve() ===");
      const gpt4o = await client.models.retrieve("gpt-4o");
      
      console.log("GPT-4o details:", gpt4o);

      // Test 3: Filter for GPT models only
      const gptModels = models
        .filter(m => m.id.includes('gpt'))
        .map(m => m.id)
        .sort();

      // Test 4: Check what fields are actually returned
      const detailedSample = models[0];
      const availableFields = Object.keys(detailedSample);

      return Response.json({
        summary: {
          total_models: models.length,
          gpt_models_count: gptModels.length,
          available_fields: availableFields,
        },
        sample_models: sampleModels,
        gpt4o_details: gpt4o,
        all_gpt_models: gptModels,
        raw_sample: detailedSample,
      }, { 
        headers: { 'Content-Type': 'application/json' },
        status: 200 
      });

    } catch (error) {
      console.error("Error testing models API:", error);
      return Response.json({
        error: error.message,
        type: error.constructor.name,
      }, { status: 500 });
    }
  }
}
