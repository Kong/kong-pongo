import {
  ChatCompletionChunk,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionCreateParamsBase,
} from "openai/resources/chat/completions";

/** Like ChatCompletionCreateParams but allow model to be empty */
export type ChatCompletionCreateParamsKong = Omit<ChatCompletionCreateParamsBase, "model"> & {
  model?: string | null;
};

/**
 * Converts an array of OpenAI JSON-format SSE events to individual OpenAI function/tool calls.
 * @param {OpenAI.Chat.Completions.ChatCompletion[]} events - An array of OpenAI SSE events.
 */
export function aiEventsToToolCalls(events: ChatCompletionChunk[]): ChatCompletionMessageFunctionToolCall[] {
  const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
  let thisTool: any = null;

  (events).forEach((ev) => {
    if (ev.choices && ev.choices.length > 0) {
      if (ev.choices[0].delta.tool_calls && ev.choices[0].delta.tool_calls.length > 0) {
        ev.choices[0].delta.tool_calls.forEach((toolCall) => {
          const functionCall = toolCall.function;

          if (functionCall?.name) {
            // Flush buffer
            if (thisTool !== null) {
              toolCalls.push(thisTool);
            }

            // Reset current function object and reset
            thisTool = {
              id: toolCall.id || "",
              type: "function",
              function: {
                name: functionCall.name,
                arguments: ""
              }
            }
          }

          if (functionCall?.arguments) thisTool.function.arguments = thisTool.function.arguments + functionCall.arguments
        });
      }

    }
  });

  // Flush buffer a final time
  if (thisTool !== null) {
    toolCalls.push(thisTool);
  }

  return toolCalls;
}

/**
 * Converts an array of OpenAI JSON-format SSE events to a concatenated string of its content delta.
 * @param {OpenAI.Chat.Completions.ChatCompletion[]} events - An array of OpenAI SSE events.
 */
export function aiEventsToContent(events: ChatCompletionChunk[]): string {
  let thisContent = "";

  (events as any[]).forEach((ev) => {
    if (ev.choices && ev.choices.length > 0 && ev.choices[0].delta && ev.choices[0].delta.content) {
      thisContent = thisContent + ev.choices[0].delta.content;
    }
  });

  return thisContent;
}
