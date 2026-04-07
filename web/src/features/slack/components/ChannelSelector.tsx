import React, { useState, useMemo, useCallback } from "react";
import { RefreshCw, Search, Hash, Lock, AlertTriangle } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/src/components/ui/popover";
import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Select, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { api } from "@/src/utils/api";
import { VirtualizedList } from "@/src/components/trace2/components/_shared/VirtualizedList";
import { cn } from "@/src/utils/tailwind";

/**
 * Represents a Slack channel
 */
export interface SlackChannel {
  id: string;
  name: string;
  /** Only known for channels from the fetched list or after a resolved test message */
  isPrivate?: boolean;
  /** Only known for channels from the fetched list */
  isMember?: boolean;
}

/**
 * Props for the ChannelSelector component
 */
interface ChannelSelectorProps {
  /** Project ID for the Slack integration */
  projectId: string;
  /** Currently selected channel ID */
  selectedChannelId?: string;
  /** Full channel object for display when the ID isn't in the fetched list (e.g. manual entry) */
  selectedChannel?: SlackChannel | null;
  /** Callback when a channel is selected */
  onChannelSelect: (channel: SlackChannel) => void;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Placeholder text for the selector */
  placeholder?: string;
  /** Whether to show only channels the bot is a member of */
  memberOnly?: boolean;
  /** Custom filter function for channels */
  filterChannels?: (channel: SlackChannel) => boolean;
  /** Whether to show the refresh button */
  showRefreshButton?: boolean;
}

const ESTIMATED_ITEM_HEIGHT = 32;
const MAX_VISIBLE_ITEMS = 10;

const ChannelIcon: React.FC<{ isPrivate?: boolean }> = ({ isPrivate }) =>
  isPrivate ? (
    <Lock className="text-muted-foreground h-4 w-4 shrink-0" />
  ) : (
    <Hash className="text-muted-foreground h-4 w-4 shrink-0" />
  );

/**
 * A dropdown component for selecting Slack channels with search and filtering capabilities.
 *
 * This component handles:
 * - Fetching available channels from the Slack API
 * - Providing search functionality to filter channels
 * - Displaying channel type indicators (public/private)
 * - Showing membership status for each channel
 * - Handling loading and error states
 * - Refreshing the channel list
 *
 * The component uses a command palette style interface for better UX when dealing with
 * many channels. It supports both keyboard navigation and mouse interaction.
 *
 * @param projectId - The project ID for the Slack integration
 * @param selectedChannelId - Currently selected channel ID
 * @param selectedChannel - Full channel object for display when the ID isn't in the fetched list (e.g. manual entry)
 * @param onChannelSelect - Callback when a channel is selected
 * @param disabled - Whether the component should be disabled
 * @param placeholder - Placeholder text for the selector
 * @param memberOnly - Whether to show only channels the bot is a member of
 * @param filterChannels - Custom filter function for channels
 * @param showRefreshButton - Whether to show the refresh button
 */
export const ChannelSelector: React.FC<ChannelSelectorProps> = ({
  projectId,
  selectedChannelId,
  selectedChannel: selectedChannelProp,
  onChannelSelect,
  disabled = false,
  placeholder = "Select a channel",
  memberOnly = false,
  filterChannels,
  showRefreshButton = true,
}) => {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get available channels
  const {
    data: channelsData,
    isLoading,
    error,
    refetch: refetchChannels,
  } = api.slack.getChannels.useQuery(
    { projectId },
    {
      enabled: !!projectId,
      // Keep data fresh
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  );

  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchChannels();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filter and search channels
  const filteredChannels = useMemo(() => {
    if (!channelsData?.channels) return [];

    let channels = channelsData.channels;

    // Apply member filter if requested
    if (memberOnly) {
      channels = channels.filter((channel) => channel.isMember);
    }

    // Apply custom filter if provided
    if (filterChannels) {
      channels = channels.filter(filterChannels);
    }

    // Apply search filter
    if (searchValue.trim()) {
      const searchTerm = searchValue.toLowerCase().trim();
      channels = channels.filter((channel) =>
        channel.name.toLowerCase().includes(searchTerm),
      );
    }

    return channels.sort((a, b) => {
      if (a.isPrivate !== b.isPrivate) {
        return a.isPrivate ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [channelsData?.channels, memberOnly, filterChannels, searchValue]);

  // Get selected channel info — fall back to the prop for manual entries
  const selectedChannel = useMemo(() => {
    if (!selectedChannelId) return null;
    const fromList = channelsData?.channels?.find(
      (channel) => channel.id === selectedChannelId,
    );
    return fromList ?? selectedChannelProp ?? null;
  }, [selectedChannelId, channelsData?.channels, selectedChannelProp]);

  const selectAndClose = useCallback(
    (channel: SlackChannel) => {
      onChannelSelect(channel);
      setOpen(false);
      setSearchValue("");
    },
    [onChannelSelect],
  );

  const handleChannelSelect = useCallback(
    (channelId: string) => {
      const channel = filteredChannels.find((c) => c.id === channelId);
      if (channel) selectAndClose(channel);
    },
    [filteredChannels, selectAndClose],
  );

  const handleSelectByName = useCallback(() => {
    const name = searchValue.replace(/^#/, "").trim();
    if (!name) return;
    selectAndClose({ id: `#${name}`, name, isPrivate: false, isMember: false });
  }, [searchValue, selectAndClose]);

  const trimmedSearch = searchValue.trim();
  const noLocalMatches =
    trimmedSearch.length > 0 && filteredChannels.length === 0;

  // Loading & error states
  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Select disabled>
          <SelectTrigger>
            <SelectValue placeholder="Loading channels..." />
          </SelectTrigger>
        </Select>
        {showRefreshButton && (
          <Button variant="outline" size="sm" disabled>
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Select disabled>
            <SelectTrigger>
              <SelectValue placeholder="Error loading channels" />
            </SelectTrigger>
          </Select>
          {showRefreshButton && (
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Alert>
          <AlertDescription>
            Failed to load channels. Please check your Slack connection and try
            again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
              disabled={disabled}
            >
              {selectedChannel ? (
                <div className="flex w-full items-center gap-2">
                  <ChannelIcon isPrivate={selectedChannel.isPrivate} />
                  <span className="flex-1 truncate">
                    {selectedChannel.name}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
              <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
          >
            {/* Search input */}
            <div className="relative flex items-center border-b p-1">
              <Search className="absolute top-1/2 left-2 h-3.5 w-3.5 shrink-0 -translate-y-1/2 opacity-50" />
              <input
                className="placeholder:text-muted-foreground flex h-8 w-full rounded-md bg-transparent py-3 pr-6 pl-6 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Search channels..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && noLocalMatches) {
                    e.preventDefault();
                    handleSelectByName();
                  }
                }}
              />
            </div>

            {/* Virtualized channel list */}
            {filteredChannels.length > 0 && (
              <div
                style={{
                  height:
                    Math.min(filteredChannels.length, MAX_VISIBLE_ITEMS) *
                    ESTIMATED_ITEM_HEIGHT,
                }}
              >
                <VirtualizedList
                  items={filteredChannels}
                  selectedItemId={selectedChannelId ?? null}
                  onSelectItem={handleChannelSelect}
                  getItemId={(ch) => ch.id}
                  estimatedItemSize={ESTIMATED_ITEM_HEIGHT}
                  overscan={20}
                  renderItem={({ item, isSelected, onSelect }) => (
                    <div
                      className={cn(
                        "flex h-8 cursor-pointer items-center rounded-sm px-2 text-sm select-none",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent hover:text-accent-foreground",
                      )}
                      onClick={onSelect}
                    >
                      <div className="flex w-full items-center gap-2">
                        <ChannelIcon isPrivate={item.isPrivate} />
                        <span className="flex-1 truncate">{item.name}</span>
                      </div>
                    </div>
                  )}
                />
              </div>
            )}

            {/* No local matches — offer to use the typed name directly */}
            {noLocalMatches && (
              <div className="p-1">
                <div
                  className="hover:bg-accent hover:text-accent-foreground flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm select-none"
                  onClick={handleSelectByName}
                >
                  <Hash className="text-muted-foreground h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">
                    Use &quot;{trimmedSearch.replace(/^#/, "")}&quot;
                  </span>
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {showRefreshButton && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={disabled || isRefreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
        )}
      </div>

      {/* Channel stats */}
      {channelsData?.channels && (
        <div className="text-muted-foreground text-xs">
          {filteredChannels.length} of {channelsData.channels.length} channels
          {memberOnly && " (member only)"}
        </div>
      )}

      {/* Private channel scope warning */}
      {channelsData && !channelsData.hasPrivateChannelAccess && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Private channels are not visible. To access private channels,{" "}
            <button
              type="button"
              className="font-medium underline"
              onClick={() =>
                window.open(
                  `/api/public/slack/install?projectId=${projectId}`,
                  "slack-reauth",
                  "width=600,height=700",
                )
              }
            >
              re-authenticate your Slack integration
            </button>{" "}
            to grant the required permissions.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};
