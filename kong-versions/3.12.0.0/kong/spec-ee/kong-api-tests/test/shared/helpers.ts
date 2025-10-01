/**
 * Converts an array of OpenAI JSON-format SSE events to individual OpenAI function/tool calls.
 * @param {any[]} events - An array of OpenAI SSE events.
 */
function aiEventsToToolCalls(events) {
  const toolCalls: any[] = [];
  let thisTool: any = null;

  (events as any[]).forEach((ev) => {
    if (ev.choices && ev.choices.length > 0) {
      if (ev.choices[0].delta.tool_calls && ev.choices[0].delta.tool_calls.length > 0) {
        ev.choices[0].delta.tool_calls.forEach((toolCall) => {
          const functionCall = toolCall.function;

          if (functionCall.name) {
            // Flush buffer
            if (thisTool !== null) {
              toolCalls.push(thisTool);
            }

            // Reset current function object and reset
            thisTool = {
              type: "function",
              function: {
                name: functionCall.name,
                arguments: ""
              }
            }
          }

          if (functionCall.arguments) thisTool.function.arguments = thisTool.function.arguments + functionCall.arguments
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
 * @param {any[]} events - An array of OpenAI SSE events.
 */
function aiEventsToContent(events) {
  let thisContent = "";

  (events as any[]).forEach((ev) => {
    if (ev.choices && ev.choices.length > 0 && ev.choices[0].delta && ev.choices[0].delta.content) {
      thisContent = thisContent + ev.choices[0].delta.content;
    }
  });

  return thisContent;
}

export {
  aiEventsToToolCalls,
  aiEventsToContent,
};
