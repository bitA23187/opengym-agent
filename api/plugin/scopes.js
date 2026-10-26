export function requireScopes(actual,required) {
  if(required.some(scope=>!actual.includes(scope))) {
    const error=new Error('Reconnect OpenGym and authorize the required scopes: '+required.join(', '));
    error.requiredScopes=required;throw error;
  }
}
