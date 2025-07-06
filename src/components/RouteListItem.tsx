interface RouteListItemProps {
  route: {
    name: string;
    [key: string]: any;
  };
  onAdd: (route: any) => void;
}

export function RouteListItem({ route, onAdd }: RouteListItemProps) {
  const displayName = route.name.replace(/^NYCS - /, "");

  const renderRouteName = (name: string) => {
    if (name.includes(":")) {
      const [title, direction] = name.split(":", 2);
      return (
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-800 truncate">
            {title.trim()}
          </div>
          {direction
            .trim()
            .split(/\s*→\s*/)
            .map((dir, i) => (
              <div
                key={i}
                className="text-xs font-medium text-gray-800 truncate"
              >
                {dir}
              </div>
            ))}
        </div>
      );
    } else {
      return (
        <div className="text-xs font-medium text-gray-800 truncate">{name}</div>
      );
    }
  };

  return (
    <div className="flex items-center gap-2 p-1 bg-gray-50 rounded">
      {renderRouteName(displayName)}
      <button
        onClick={() => onAdd(route)}
        className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 flex-shrink-0"
      >
        Add
      </button>
    </div>
  );
}
